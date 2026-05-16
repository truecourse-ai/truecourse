
type ChangeHandler = (value: string) => void;

class InputController {
  private changeHandlers: ChangeHandler[] = [];

  registerChangeHandler(handler: ChangeHandler) {
    this.changeHandlers.push(handler);
  }

  unregisterChangeHandler(handler: ChangeHandler) {
    this.changeHandlers = this.changeHandlers.filter(h => h !== handler);
  }

  notifyChange(value: string) {
    for (const handler of this.changeHandlers) {
      handler(value);
    }
  }
}
