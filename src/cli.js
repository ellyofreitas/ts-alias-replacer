const createParam = (param) =>
  new RegExp(`(--${param}(=|\\s)?(?<${param}>[^\\s]*))`);

export function exit(message, exitCode = 1) {
  console.info('ReplaceAlias:', message);
  process.exit(1);
}

export function resolveArguments(params) {
  const commandRaw = process.argv.slice(1).join(' ');

  const argsParams = params
    .map((param) => createParam(param).exec(commandRaw))
    .reduce((acc, item) => ({ ...acc, ...(item?.groups || {}) }), {});

  const argsValues = params
    .reduce(
      (acc, param) => acc.replace(createParam(param), '').trim(),
      process.argv.slice(2).join(' ')
    )
    .split(' ')
    .reduce(
      (acc, value, index) => ({
        ...acc,
        ...(value && { [`$${index + 1}`]: value }),
      }),
      {}
    );

  const args = { ...argsValues, ...argsParams };

  return args;
}
