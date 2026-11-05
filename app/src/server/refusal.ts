export class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
