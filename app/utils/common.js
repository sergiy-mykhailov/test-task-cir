export const timeout = (duration = 1001) => new Promise((res) => setTimeout(() => res(true), duration));
