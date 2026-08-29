export function add(a, b) {
  return a + b;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`HARNESS_OK=${add(2, 3)}`);
}
