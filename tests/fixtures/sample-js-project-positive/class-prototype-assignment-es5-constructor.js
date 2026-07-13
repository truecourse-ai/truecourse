// An ES5 constructor function with methods assigned onto its `.prototype`.
// This is the idiomatic ES5 pattern — there is no `class` declaration for the
// receiver, so it is not "inconsistent with class syntax" and must not be
// flagged. (`export` keeps it a module so the top-level function isn't
// separately flagged as an implicit global.)
export function ToastService() {
  this.queue = [];
}

ToastService.prototype.show = function (message) {
  this.queue.push(message);
};

ToastService.prototype.dismiss = function (id) {
  this.queue = this.queue.filter((toast) => toast.id !== id);
};
