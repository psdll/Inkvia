// P1 preview uses the already-provisioned P0 isolated resources and deny-by-default network policy.
process.env.INKVIA_AGENT_RUNTIME_VERSION = '2';
require('./dev-p0.cjs');
