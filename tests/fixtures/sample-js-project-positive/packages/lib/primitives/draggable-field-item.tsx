declare function onFieldActivate(): void;
declare const onFocus: (() => void) | undefined;
declare const onBlur: (() => void) | undefined;
declare const RndComponent: any;

const DraggableFieldItem = () => {
  return (
    <RndComponent
      onDragStart={() => onFieldActivate?.()}
      onResizeStart={() => onFieldActivate?.()}
      onMouseEnter={() => onFocus?.()}
      onMouseLeave={() => onBlur?.()}
    />
  );
};
