const issuerUrl = process.env.KINDE_ISSUER_URL;
const clientId = process.env.KINDE_CLIENT_ID;

if (!issuerUrl) {
  throw new Error("KINDE_ISSUER_URL environment variable is required");
}
if (!clientId) {
  throw new Error("KINDE_CLIENT_ID environment variable is required");
}

const authConfig = {
  providers: [
    {
      domain: issuerUrl,
      applicationID: clientId,
    },
  ],
};

export default authConfig;
