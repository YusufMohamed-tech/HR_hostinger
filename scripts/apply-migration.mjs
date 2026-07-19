console.error("Single-file migrations are disabled because they bypass ordering and checksum history.");
console.error("Use `npm run db:migrate -- --status` and then `npm run db:migrate`.");
process.exit(1);
