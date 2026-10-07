import type { CompetitionDto, SignedInArcher } from '@inscript-carte/shared';
import { createContext, use, useMemo, useState, type ReactNode } from 'react';

import { useSession } from '@/auth/session';

import { MyRegistrationsDialog } from './my-registrations-dialog';
import { RegistrantsDialog } from './registrants-dialog';
import { RegistrationFormDialog } from './registration-form-dialog';

type RegistrationActions = {
  register: (competition: CompetitionDto) => void;
  showRegistrants: (competition: CompetitionDto) => void;
  showMyRegistrations: () => void;
};

const RegistrationActionsContext = createContext<RegistrationActions | null>(null);

export function useRegistrationActions(): RegistrationActions {
  const value = use(RegistrationActionsContext);
  if (!value) throw new Error('useRegistrationActions must be used inside RegistrationActionsProvider');
  return value;
}

type OpenDialog =
  | { kind: 'register' | 'registrants'; competition: CompetitionDto; archer: SignedInArcher }
  | { kind: 'mine'; archer: SignedInArcher };

/** Every registration action asks to sign in first when needed, then opens its dialog. */
export function RegistrationActionsProvider({
  children,
  onRegistrationsChanged,
}: {
  children: ReactNode;
  /** Registration counts changed: reload the competitions. */
  onRegistrationsChanged: () => void;
}) {
  const { withArcher } = useSession();
  const [dialog, setDialog] = useState<OpenDialog | null>(null);

  const actions = useMemo<RegistrationActions>(
    () => ({
      register: (competition) => withArcher((archer) => setDialog({ kind: 'register', competition, archer })),
      showRegistrants: (competition) => withArcher((archer) => setDialog({ kind: 'registrants', competition, archer })),
      showMyRegistrations: () => withArcher((archer) => setDialog({ kind: 'mine', archer })),
    }),
    [withArcher],
  );
  const close = () => setDialog(null);

  return (
    <RegistrationActionsContext value={actions}>
      {children}
      {dialog?.kind === 'register' && (
        <RegistrationFormDialog
          competition={dialog.competition}
          archer={dialog.archer}
          onClose={close}
          onRegistered={onRegistrationsChanged}
        />
      )}
      {dialog?.kind === 'registrants' && <RegistrantsDialog competition={dialog.competition} onClose={close} />}
      {dialog?.kind === 'mine' && (
        <MyRegistrationsDialog archer={dialog.archer} onClose={close} onWithdrawn={onRegistrationsChanged} />
      )}
    </RegistrationActionsContext>
  );
}
