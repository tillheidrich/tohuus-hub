/**
 * Allergies are health data (Art. 9 GDPR). The server refuses the first allergy of a person without an explicit
 * confirmation (HTTP 409, code 'health_consent'); this sheet asks once and the save is repeated with `consent: true`.
 */
import { useRef, useState } from 'react';
import { ApiError } from '../api';
import { t } from '../i18n';
import { Sheet } from '../ui';

export function useHealthConsent() {
  const [open, setOpen] = useState(false);
  const answer = useRef<(ok: boolean) => void>(() => {});
  const ask = () =>
    new Promise<boolean>((resolve) => {
      answer.current = resolve;
      setOpen(true);
    });
  const close = (ok: boolean) => {
    setOpen(false);
    answer.current(ok);
    answer.current = () => {};
  };
  /** Runs `save`; when the server wants a confirmation, asks and runs it again with consent. Null when declined. */
  const withConsent = async <T,>(save: (consent?: boolean) => Promise<T>): Promise<T | null> => {
    try {
      return await save();
    } catch (e) {
      if (!(e instanceof ApiError) || e.code !== 'health_consent') throw e;
      return (await ask()) ? save(true) : null;
    }
  };
  const sheet = (
    <Sheet
      open={open}
      onClose={() => close(false)}
      title={t('Save allergies?')}
      footer={
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => close(false)}>
            {t('Not now')}
          </button>
          <button className="btn primary" onClick={() => close(true)}>
            {t('Save')}
          </button>
        </div>
      }
    >
      <p style={{ margin: 0 }}>
        {t('Allergies are health data. ToHuus stores them encrypted in your household and only uses them for warnings on recipes. They only go to the assistant if you allow that in the settings.')}
      </p>
    </Sheet>
  );
  return { withConsent, sheet };
}
