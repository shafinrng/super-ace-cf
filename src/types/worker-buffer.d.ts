// Type-level shim only: @cloudflare/workers-types' NonSharedBuffer (what
// node:crypto randomBytes returns under nodejs_compat) doesn't declare the
// classic Buffer read methods. workerd implements them at runtime, and the
// monte-carlo runs under real Node where Buffer has them natively. This
// declaration merge keeps ReelGenerator.ts byte-identical to the reference
// repo instead of rewriting its RNG read.
interface NonSharedBuffer {
  readUInt32BE(offset?: number): number;
}
