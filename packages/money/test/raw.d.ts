// Lets tests read a text file as a string (the test runner supports "?raw").
declare module '*?raw' {
  const text: string;
  export default text;
}
