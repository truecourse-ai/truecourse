import { User, UserModel } from "./some-types";
declare const cfg: { user?: User };
export function getName(): string {
  return cfg.user?.name ?? "";
}
