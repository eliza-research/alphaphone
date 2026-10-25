// Generated from config/cloud-deployment.json. Run node scripts/cloud-deployment.mjs.
export const productionCloud = {"api":"https://api.eliza.app","web":"https://eliza.app","agents":"cloud.eliza.app","tenant":"elizacloud"} as const;
export const stagingCloud = {"api":"https://api-staging.eliza.app","web":"https://staging.eliza.app","agents":"cloud-staging.eliza.app","tenant":"elizacloud-staging"} as const;
export const cloudStorageNamespace = "cloud-deployment:f0c461d55a4198b52603961f433922aaa026d5e833039df210e7e3d3f07d394f:";
export function cloudStorageSlot(name:string):string { return name.startsWith("cloud:") || name.startsWith("cloud-signin:") || name === "local-agent-provider:v1" ? cloudStorageNamespace + name : name; }
