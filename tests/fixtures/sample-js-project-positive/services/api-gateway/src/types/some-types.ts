export interface User {
  id: string;
  name: string;
}
export class UserModel {
  static create(): User { return { id: "", name: "" }; }
}
