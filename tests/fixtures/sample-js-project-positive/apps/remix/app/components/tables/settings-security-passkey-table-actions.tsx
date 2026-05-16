declare function DialogTrigger(props: any): any;

const PasskeyTableActions = () => {
  return (
    <div className="flex justify-end space-x-2">
      <DialogTrigger onClick={(e: any) => e.stopPropagation()} asChild>
        <button type="button">Edit</button>
      </DialogTrigger>
    </div>
  );
};
