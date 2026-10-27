# Approved membership sheet

The visual source is `design/membership-layout-options.html`, option **B. Bottom sheet**.
Its preserved SHA-256 is `c66e13d3fd52137f445f2abb53d19c0eaf86ae4a6868faf052eec110a79de88f`.
It is a design reference with synthetic values, not a payment implementation.

In the Alpha UI chat, the owner selected B on 2026-10-25 at 04:18:30 UTC and rejected
having to open a second “Have a membership code?” dropdown after “Use membership code”.
The owner then said “proceed” at 06:55:23 UTC. The current live component still used
its flat account facts. This change applies the recovered design to that component.

The real account, exact credit value, membership and expiry information, loading/error
states and existing callbacks remain authoritative. Opening code entry focuses the input
in one step. The separate billing-account acknowledgment and payment flow remain intact.
UI tests and previews use synthetic facts and callbacks; they never redeem codes, fund
an account, switch a real account or change a subscription.

Local UI checks, integrated Mac acceptance, Android qualification and physical acceptance
are separate gates. An isolated preview does not establish financial or device acceptance.
