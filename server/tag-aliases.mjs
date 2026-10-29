export function applyTagAliases(tags, aliases = {}) {
  return [
    ...new Set(
      tags
        .map((original) => {
          let name = original;
          const seen = new Set();
          while (name && Object.hasOwn(aliases, name)) {
            if (seen.has(name)) return null;
            seen.add(name);
            name = aliases[name];
          }
          return name;
        })
        .filter(Boolean),
    ),
  ];
}
