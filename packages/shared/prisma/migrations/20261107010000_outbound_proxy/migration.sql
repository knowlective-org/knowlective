-- The link preview proxy becomes the proxy for all outbound connections
-- (renamed, so a saved proxy carries over).
ALTER TABLE "InstanceConfig" RENAME COLUMN "linkPreviewProxyUrl" TO "outboundProxyUrl";
ALTER TABLE "InstanceConfig" RENAME COLUMN "linkPreviewProxyUsername" TO "outboundProxyUsername";
ALTER TABLE "InstanceConfig" RENAME COLUMN "linkPreviewProxyPasswordEnc" TO "outboundProxyPasswordEnc";
ALTER TABLE "InstanceConfig" ADD COLUMN "outboundProxyBypass" TEXT[] DEFAULT ARRAY[]::TEXT[];
