/**
 * Create the shell variable store and parameter expansion helpers.
 *
 * @returns {{
 *   expandParameters: (args: string[]) => string[],
 *   isValidShellIdentifier: (variableName: string) => boolean,
 *   shellVariables: Map<string, string>
 * }} The variables API.
 */
const createVariables = () => {
  const shellVariables = new Map();

  /**
   * Check whether a name is a valid shell identifier.
   *
   * @param {string} variableName - The candidate name.
   * @returns {boolean} True when the name matches `[A-Za-z_][A-Za-z0-9_]*`.
   */
  const isValidShellIdentifier = (variableName) => {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(variableName);
  };

  /**
   * Expand `$VAR` and `${VAR}` references in each argument. Undefined
   * variables expand to an empty string; arguments that become empty are
   * dropped.
   *
   * @param {string[]} args - The tokens to expand.
   * @returns {string[]} The expanded, non-empty tokens.
   */
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

export { createVariables };
