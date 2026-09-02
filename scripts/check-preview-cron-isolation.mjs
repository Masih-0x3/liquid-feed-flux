import { assertPreviewCronIsolationContract } from "./preview-cron-isolation.mjs";

const findings = assertPreviewCronIsolationContract();
console.log(`PREVIEW_CRON_ISOLATION_SOURCE_CONTRACT_PASS hazards=${findings.length}`);
