// Single field advanced settings file sets textAlign: 'left' — standalone style value
interface TextFieldSettings {
  textAlign: 'left' | 'center' | 'right';
  fontSize: number;
  fontFamily: string;
}

const defaultTextFieldSettings: TextFieldSettings = {
  textAlign: 'left',
  fontSize: 12,
  fontFamily: 'Helvetica',
};

function applyTextSettings(el: HTMLElement, settings: TextFieldSettings) {
  el.style.textAlign = settings.textAlign;
  el.style.fontSize = `${settings.fontSize}px`;
  el.style.fontFamily = settings.fontFamily;
}
