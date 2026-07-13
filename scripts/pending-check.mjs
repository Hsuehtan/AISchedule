const [task, command] = process.argv.slice(2);

console.error(`${command ?? 'Command'} is intentionally unavailable until ${task ?? 'its task'}.`);
process.exitCode = 1;
