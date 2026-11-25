require("./lib/runtime-isolation.cjs").prepareRuntime().then(report => {
  console.log(JSON.stringify(report));
}).catch(error => { console.error(error.code || "ENV_IDENTITY_UNVERIFIED"); process.exitCode = 1; });
