// An ES6 class whose method is grafted on externally via `.prototype`. This
// IS the inconsistent pattern the rule targets: the receiver is a real `class`
// declared in the same file, so the method belongs in the class body.
export class Toast {
  constructor() {
    this.queue = [];
  }
}

// VIOLATION: code-quality/deterministic/class-prototype-assignment
Toast.prototype.show = function (message) {
  this.queue.push(message);
};
