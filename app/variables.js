const createVariables = () => {
  const shellVariables = new Map();

  const isValidShellIdentifier = (variableName) => {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(variableName);
  };

  const expandParameters = (args) => {
    return args
      .map((arg) => {
        return arg
          .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, variableName) => {
            return shellVariables.get(variableName) ?? '';
          })
          .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, variableName) => {
            return shellVariables.get(variableName) ?? '';
          });
      })
      .filter((arg) => arg !== '');
  };

  return {
    expandParameters,
    isValidShellIdentifier,
    shellVariables,
  };
};

module.exports = {
  createVariables,
};
