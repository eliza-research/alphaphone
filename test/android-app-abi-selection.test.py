"""Execute the production Groovy ABI selection and build-type filters without Gradle tasks."""
import json, os, shutil, subprocess, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GRADLE_CACHE = Path(os.environ.get('GRADLE_USER_HOME', Path.home()/'.gradle'))
GROOVY_JARS = list(GRADLE_CACHE.glob('wrapper/dists/gradle-*/**/lib/groovy-[0-9]*.jar'))
JAVA = str(Path(os.environ['JAVA_HOME'])/'bin/java') if os.environ.get('JAVA_HOME') else shutil.which('java')

def block(text, marker):
    start = text.index(marker) + len(marker)
    depth = 1
    for pos in range(start, len(text)):
        depth += (text[pos] == '{') - (text[pos] == '}')
        if depth == 0:
            return text[start:pos]
    raise AssertionError('Unclosed production block')

class AndroidAppAbis(unittest.TestCase):
    def select(self, env, props=None):
        self.assertTrue(GROOVY_JARS, 'An existing Gradle wrapper distribution is required; no download is started')
        self.assertTrue(JAVA, 'Java is required')
        groovy_json = GROOVY_JARS[0].with_name(GROOVY_JARS[0].name.replace('groovy-', 'groovy-json-'))
        self.assertTrue(groovy_json.is_file(), 'Matching Groovy JSON library is required')
        classpath = os.pathsep.join([str(GROOVY_JARS[0]), str(groovy_json)])
        source = (ROOT/'android/app/build.gradle').read_text()
        selection = source[source.index('// Use the same explicit target'):].split('android {', 1)[0]
        build_types = block(source, ' buildTypes {')
        driver = """class GradleException extends RuntimeException { GradleException(String s) { super(s) } }
class TypeConfig {
  List abiFilters = []
  void abiFilters(Object... values) { abiFilters.addAll(values) }
  def methodMissing(String name, args) { if (name == 'ndk') { args[0].delegate = this; args[0].resolveStrategy = Closure.DELEGATE_FIRST; args[0]() } }
}
def props = new groovy.json.JsonSlurper().parseText(args[0])
def project = [findProperty: { name -> props[name] }]
""" + selection + """
def observed = [:]
def testMocksEnabled = false
def releaseSigningReady = false
def getDefaultProguardFile = { name -> name }
def debug = { Closure body -> def config = new TypeConfig(); body.delegate = config; body.resolveStrategy = Closure.DELEGATE_FIRST; body(); observed.debug = config.abiFilters }
def release = { Closure body -> def config = new TypeConfig(); body.delegate = config; body.resolveStrategy = Closure.DELEGATE_FIRST; body(); observed.release = config.abiFilters }
""" + build_types + """
println(observed.debug.join(',') + '|' + observed.release.join(','))
"""
        clean = {k:v for k,v in os.environ.items() if k not in ['ELIZA_ANDROID_TARGET_ABIS', 'ELIZA_ANDROID_BUN_TARGET']}
        clean.update(env)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'selection.groovy'; path.write_text(driver)
            return subprocess.run([str(JAVA), '-Xmx128m', '-cp', classpath, 'groovy.ui.GroovyMain', str(path), json.dumps(props or {})], env=clean, capture_output=True, text=True)

    def test_default_dual_and_explicit_android_arm64(self):
        for env, expected in [({}, 'arm64-v8a,x86_64|arm64-v8a'), ({'ELIZA_ANDROID_BUN_TARGET':'android', 'ELIZA_ANDROID_TARGET_ABIS':'arm64-v8a'}, 'arm64-v8a|arm64-v8a'), ({'ELIZA_ANDROID_TARGET_ABIS':'arm64-v8a,x86_64'}, 'arm64-v8a,x86_64|arm64-v8a')]:
            with self.subTest(env=env):
                result = self.select(env)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout.strip(), expected)

    def test_invalid_or_unsupported_android_selections_fail(self):
        for value in ['', 'riscv64', 'arm64-v8a,', 'arm64-v8a,arm64-v8a', 'x86_64', 'arm64-v8a,x86_64']:
            with self.subTest(value=value):
                result = self.select({'ELIZA_ANDROID_BUN_TARGET':'android', 'ELIZA_ANDROID_TARGET_ABIS':value})
                self.assertNotEqual(result.returncode, 0)
                self.assertRegex(result.stderr, r'(Invalid ELIZA_ANDROID_TARGET_ABIS|Android Bun requires the explicit arm64-v8a target)')
                self.assertNotIn('MultipleCompilationErrorsException', result.stderr)
        result = self.select({'ELIZA_ANDROID_BUN_TARGET':'other'})
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Android Bun requires the explicit arm64-v8a target', result.stderr)

    def test_existing_gradle_property_selects_same_target(self):
        result = self.select({}, {'ELIZA_ANDROID_BUN_TARGET':'android', 'ELIZA_ANDROID_TARGET_ABIS':'arm64-v8a'})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), 'arm64-v8a|arm64-v8a')

if __name__ == '__main__': unittest.main()
