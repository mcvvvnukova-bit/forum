# Demo widget display customization

## Approved behavior

The user requests changes to the native Cal.diy popup opened by «Выбрать время» on `https://dev.astforum.ru`. Its booking event is `https://cal.astforum.ru/demo/60min` (namespace `60min`, current event ID 3).

1. Always display booking times in 24-hour format, including when the visitor's browser or previously saved preference selects 12-hour format. Do not render the 12/24-hour format switch.
2. Do not render the event-details row «Требуется подтверждение».
3. Do not render the event-details location row currently showing «Cal Video».

The user explicitly confirmed that bookings must still require manual confirmation. These are presentation-only changes: retain `requiresConfirmation`, the selected meeting provider and all booking data. Do not enable automatic confirmation. Keep truthful pending-confirmation status after submission; only remove the specified information row from the booking window.

## Approach

Use a small, scoped presentation policy in the existing Cal.diy React booking components. Activate it only for the embedded `demo/60min` booking flow. Derive the effective time format during rendering without changing the visitor's saved global time preference. Skip rendering the time-format toggle and the two event-detail rows for that flow.

Preserve the native Cal.diy popup, its existing styles, title, description, duration, timezone selector, calendar, slots and form. Do not hide the whole event-details column and do not inject CSS from the landing across the iframe boundary. Other booking pages, events and the admin interface retain their existing presentation.

Alternatives considered: changing event settings would alter manual approval/video behavior and contradict the request; CSS-only hiding would not reliably enforce 24-hour times against persisted browser preferences. Scoped rendering is recommended.

## Implementation boundaries

- Fork: `cal-diy-astforum`, based on the currently deployed fork revision `1cc628c`.
- Expected integration points: `useBookerTime.ts`, `TimeFormatToggle.tsx`, and the booking `EventDetails` component. Reuse existing embed and booking context rather than introducing another UI framework or globally mutating the time-preference store.
- No database migrations, event-setting writes, new dependencies, SMTP changes, calendar/video integration changes or unrelated refactoring.
- Build a new pinned Cal.diy image and publish it to the existing AST Forum VPS. Keep the prior image/configuration available for rollback; do not reinstall the database or other services.

## Verification

- Tests first: 24-hour format overrides a stored 12-hour preference in the target widget; unaffected contexts preserve the original preference; the switch and two rows are absent only in the target widget.
- Confirm that the input event's manual-confirmation and location values remain unchanged.
- Run focused tests, relevant TypeScript checks and formatting checks, then build the production image.
- In a browser, check the published popup at desktop and mobile sizes, including a saved 12-hour preference, slot selection, form display and close/reopen. Check unrelated public booking presentation remains unchanged.
- Do not submit a real booking or send mail during verification. Read-only checks of existing event settings are permitted.

## Review

The requested visual behavior and preservation of manual confirmation are agreed in conversation. Written-spec approval is the remaining brainstorming gate before implementation planning and code changes.
