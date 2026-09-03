# Business records and the address

Several public records name Calvin Solutions LLC and its mailing address. They
have to agree. This is the list, because most of them live outside this
repository and are the ones that actually go stale.

## The address

```
Calvin Solutions LLC
617 Locust Street #1001
Monticello, MN 55362
United States
```

A registered-agent address, deliberately, rather than a home one — it is public
in at least three places, and a home address published on a website gets
scraped and archived in a way a federal database does not.

## Where it lives in this repository

**One file: `lib/businessInfo.ts`.** Every page reads from it, so pages cannot
disagree with each other, and `__tests__/business-info.test.ts` fails if one
starts hardcoding an address of its own.

| Page | What it shows |
| --- | --- |
| `/dmca` | The designated agent block — name, address, phone, email |
| `/terms` | Section 15, "Contact" |
| `/privacy` | "Contact us" |

Change it in `lib/businessInfo.ts`, then work through the table below.

## Where it lives outside this repository

These are the ones that go stale, because nothing in CI can see them.

| Record | Carries | Change it at | Notes |
| --- | --- | --- | --- |
| **U.S. Copyright Office — DMCA designated agent** | Agent name, address, phone, email | `dmca.copyright.gov` | **Renew by September 2, 2029.** Three-year term; a lapsed designation means no safe harbour |
| **Minnesota Secretary of State — LLC** | Registered office address, and often a separate *principal executive office* address | `mblsportal.sos.state.mn.us` | Changing the registered agent updates only the first. Check both fields, or the home address stays public |
| **Stripe** | Business address on receipts and invoices | Stripe Dashboard → Business settings | Customers see this on every receipt |
| **Prodigi** | Account and billing address | Prodigi dashboard | Not shown to customers; returns may use it |
| **Domain registration** | Registrant contact | Registrar | Usually behind WHOIS privacy |

## When the address changes

1. Edit `lib/businessInfo.ts`. Every page follows.
2. **Amend the Copyright Office designation first, or in the same sitting.** The
   published page and the registration disagreeing is worse than either being
   out of date alone — a notice sent to a stale address never arrives, and the
   mismatch undermines the designation.
3. Amend the Minnesota filing. `$35` by mail, `$55` online. Check the principal
   executive office field as well as the registered office.
4. Work down the rest of the table.

## Registration renewals

| What | Due | Consequence of missing it |
| --- | --- | --- |
| DMCA designated agent | **September 2, 2029** | Safe harbour under 17 U.S.C. § 512(c) lapses — the platform becomes directly liable for what guests upload |
| Minnesota LLC annual renewal | Every year, by December 31 | The LLC is administratively dissolved; it can be reinstated, but the liability shield gaps |

Nothing automated watches either date. The DMCA one is at least printed at the
bottom of `/dmca`, and asserted by a test, so it is visible.

## Still open

- The **governing-law state** in the Terms is a placeholder
  (`GOVERNING_STATE` in `pages/terms.tsx`) rather than a named state.
- Terms of sale for prints, and auto-renewal disclosures for the Corporate
  subscription, are not written. See the notes on `/dmca`'s PR for the wider
  legal gaps an attorney should look at — including whether § 512(c) safe
  harbour reaches print orders, which sell copies of user-uploaded images
  rather than merely storing them.
