import fs from 'node:fs';
// The product record is the one identity source: the shell reads identity.characterName for its
// header and composer, and the host receives the same name through upstream's local character
// override (vendor/eliza/packages/agent/src/runtime/sandbox-character.ts). ELIZA_AGENT_CHARACTER_JSON
// merges onto agents.list[0] and ui.assistant.name in memory at every boot, so an existing profile
// presents as the product on its next start without its eliza.json being rewritten. No system prompt
// is supplied: the bundled default preset keeps its style and its "{{name}}, made by Eliza Research"
// origin line, which build-character-config renders with this name.
const {identity}=JSON.parse(fs.readFileSync(new URL('../config/alpha-product.json',import.meta.url),'utf8'));
for(const key of ['characterName','appName'])if(typeof identity?.[key]!=='string'||!identity[key].trim())throw Error(`config/alpha-product.json identity.${key} required`);
export const AGENT_CHARACTER=Object.freeze({name:identity.characterName,bio:[`The assistant built into ${identity.appName} for writing, research, decisions and practical follow-through.`]});
export const AGENT_CHARACTER_ENVIRONMENT=Object.freeze({ELIZA_AGENT_CHARACTER_JSON:JSON.stringify(AGENT_CHARACTER)});
