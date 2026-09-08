/** A provider rejection that another identical request cannot repair, such as exhausted credits. */
export class PermanentModelFailure extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PermanentModelFailure";
  }
}
