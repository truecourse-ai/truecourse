// import type { PDFDocument, PDFFont, PDFTextField } from '@cantoo/pdf-lib';
// import { degrees, RotationTypes, radiansToDegrees, rgb, setFontAndSize, TextAlignment } from '@cantoo/pdf-lib';
import {
// import { fromCheckboxValue } from '@documenso/lib/universal/field-checkbox';
// import { isSignatureFieldType } from '@documenso/prisma/guards/is-signature-field';
// import type { FieldWithSignature } from '@documenso/prisma/types/field-with-signature';
// import fontkit from '@pdf-lib/fontkit';
// import { FieldType } from '@prisma/client';
// import { match, P } from 'ts-pattern';
// import { NEXT_PRIVATE_INTERNAL_WEBAPP_URL } from '../../constants/app';
import {
// import { getPageSize } from './get-page-size';

// ── snippet ──
        // First, save current line if it's not empty
        if (currentLine.length > 0) {
          lines.push(currentLine);
          currentLine = '';
        }

        // Check if word fits on a line by itself
        if (font.widthOfTextAtSize(word, fontSize) <= maxWidth) {
          // Word fits on its own line
          currentLine = word;
        } else {
          // Word is too long, need to break it character by character
          let charLine = '';

          // Process each character in the word
          for (const char of word) {
            const nextCharLine = charLine + char;

            if (font.widthOfTextAtSize(nextCharLine, fontSize) <= maxWidth) {
              // Character fits, add it
              charLine = nextCharLine;
            } else {
              // Character doesn't fit, push current charLine and start a new one
              lines.push(charLine);
              charLine = char;
            }
          }

          // Add any remaining characters as the current line
          currentLine = charLine;
        }
      }
    }

    // Add the last line if not empty
    if (currentLine.length > 0) {
      lines.push(currentLine);
    }
  }

  return lines.join('\n');
}

const setTextFieldFontSize = (textField: PDFTextField, font: PDFFont, fontSize: number) => {
  textField.defaultUpdateAppearances(font);
  textField.updateAppearances(font);

  try {
    textField.setFontSize(fontSize);
  } catch (err) {
    let da = textField.acroField.getDefaultAppearance() ?? '';

    da += `\n ${setFontAndSize(font.name, fontSize)}`;

    textField.acroField.setDefaultAppearance(da);
  }

  textField.defaultUpdateAppearances(font);
  textField.updateAppearances(font);
};
