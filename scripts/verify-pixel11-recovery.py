"""Offline stock-package checks. Never executes a ZIP member or contacts a phone."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import stat
import struct
import zipfile


class Slice(io.RawIOBase):
    """Seek within a stored nested ZIP without extracting a second 15 GB file."""
    def __init__(self, stream, start, size):
        self.stream, self.start, self.size, self.position = stream, start, size, 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        position = offset if whence == 0 else self.position + offset if whence == 1 else self.size + offset if whence == 2 else -1
        if position < 0:
            raise ValueError('invalid archive seek')
        self.position = position
        return position

    def read(self, size=-1):
        size = min(self.size - self.position, size if size >= 0 else self.size)
        if size <= 0:
            return b''
        self.stream.seek(self.start + self.position)
        data = self.stream.read(size)
        self.position += len(data)
        return data


def inspect_zip(archive, budget):
    entries = archive.infolist()
    names = [item.filename for item in entries]
    if len(entries) > 4096 or len(set(names)) != len(names):
        raise ValueError('duplicate or excessive ZIP entries')
    if sum(item.file_size for item in entries) > budget:
        raise ValueError('ZIP expansion exceeds inspection budget')
    for item in entries:
        name = PurePosixPath(item.filename)
        if name.is_absolute() or '..' in name.parts or '\\' in item.filename or item.flag_bits & 1:
            raise ValueError('unsafe or encrypted ZIP member')
    bad = archive.testzip()
    if bad is not None:
        raise ValueError('ZIP CRC failure: ' + bad)
    return names


def verify_factory(file, lock):
    pin = lock['rollbackFactoryImage']
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size != pin['sizeBytes']:
            raise ValueError('factory is not a regular file of the pinned size')
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
        if digest != pin['sha256']:
            raise ValueError('factory SHA-256 mismatch')
        stream.seek(0)
        with zipfile.ZipFile(stream) as outer:
            names = inspect_zip(outer, pin['sizeBytes'] * 4)
            expected = 'image-grizzly-' + pin['buildId'].lower() + '.zip'
            matches = [name for name in names if PurePosixPath(name).name == expected]
            if len(matches) != 1:
                raise ValueError('missing or ambiguous grizzly image ZIP')
            member = outer.getinfo(matches[0])
            if member.compress_type != zipfile.ZIP_STORED:
                raise ValueError('unexpected outer compression for image ZIP')
            stream.seek(member.header_offset)
            header = stream.read(30)
            if len(header) != 30 or header[:4] != b'PK\x03\x04':
                raise ValueError('invalid nested ZIP local header')
            name_size, extra_size = struct.unpack_from('<HH', header, 26)
            start = member.header_offset + 30 + name_size + extra_size
            if start + member.file_size > before.st_size:
                raise ValueError('nested ZIP exceeds factory boundary')
            with zipfile.ZipFile(Slice(stream, start, member.file_size)) as images:
                image_names = inspect_zip(images, pin['sizeBytes'] * 4)
                required = ['android-info.txt', 'fastboot-info.txt', 'boot.img', 'init_boot.img', 'vendor_boot.img', 'vendor_kernel_boot.img', 'dtbo.img', 'pvmfw.img', 'vbmeta.img', 'vbmeta_system.img', 'vbmeta_vendor.img', 'super_empty.img', 'system.img', 'system_dlkm.img', 'system_ext.img', 'product.img', 'vendor.img', 'vendor_dlkm.img', 'system_other.img']
                if not set(required).issubset(image_names):
                    raise ValueError('stock recovery image set incomplete')
                text = {}
                for name in ['android-info.txt', 'fastboot-info.txt']:
                    if images.getinfo(name).file_size > 65536:
                        raise ValueError('oversized metadata')
                    text[name] = images.read(name).decode('utf-8')
                requirements = lock['generatedVendor']['requiredTextFiles']
                firmware = next(item['includes'] for item in requirements if item['path'].endswith('firmware/android-info.txt'))
                lines = text['android-info.txt'].splitlines()
                for requirement in firmware:
                    if requirement.startswith(('require version-bootloader=', 'require version-baseband=')) and requirement not in lines:
                        raise ValueError('stock firmware requirements differ from source lock')
                boards = [line.split('=', 1)[1].split('|') for line in lines if line.startswith('require board=')]
                if len(boards) != 1 or 'grizzly' not in boards[0]:
                    raise ValueError('stock archive does not admit grizzly')
                image_hashes = {}
                for name in ['vbmeta.img', 'vbmeta_system.img', 'vbmeta_vendor.img']:
                    if images.getinfo(name).file_size > 65536:
                        raise ValueError('oversized stock vbmeta')
                    image_hashes[name] = hashlib.sha256(images.read(name)).hexdigest()
        after = os.fstat(stream.fileno())
        named = os.lstat(file)
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        if not stat.S_ISREG(named.st_mode) or identity(before) != identity(after) or identity(before) != identity(named):
            raise ValueError('factory changed during inspection')
    return {'schemaVersion': 1, 'factorySha256': digest, 'outerAndInnerCrcVerified': True,
            'stockFirmwareRequirementsMatch': True, 'images': image_names, 'metadata': text,
            'vbmetaSha256': image_hashes, 'deployReady': False, 'restorationTested': False,
            'boundary': 'Archive integrity and contents only; no signature, device compatibility, anti-rollback, boot or restoration qualification.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('factory', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    lock_path = Path(__file__).resolve().parents[1] / 'vendor/eliza/packages/os/android/pixel11pro.lock.json'
    try:
        result = verify_factory(args.factory, json.loads(lock_path.read_text()))
        output = json.dumps(result, indent=2) + '\n'
        if args.output:
            with args.output.open('x') as dest:
                dest.write(output)
        print(output, end='')
    except (OSError, ValueError, KeyError, StopIteration, zipfile.BadZipFile) as error:
        parser.exit(1, str(error) + '\n')
