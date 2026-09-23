export {};

declare module './spatial.js' {
  const createModule: (opts?: any) => Promise<any>;
  export default createModule;
}
