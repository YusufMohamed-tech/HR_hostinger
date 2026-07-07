# On-ground Agent SIM & Package Model Discussion

Status: discussion draft
Implementation: do not code until explicitly approved

## Purpose

We are designing the on-ground SIM distribution flow separately from the normal sales agent flow.

The system must support:

- An on-ground agent manager operating the SIM distribution business.
- On-ground agents who hold and distribute physical SIM cards.
- Traders / small businesses who receive SIM cards from on-ground agents.
- Package-based sales where the SIM is sold with a selected package / baqa.
- Commission calculation for both on-ground agents and traders.
- Reporting on the best agents, best traders, best buyers/resellers, packages, stock, and money.

## Main Actors

### On-ground Agent Manager

The on-ground agent manager should be able to:

- Create on-ground agents.
- Assign SIM cards to on-ground agents.
- See and manage SIM stock.
- Create/add stock.
- See all on-ground agents.
- See all traders created by on-ground agents.
- See all sales made by traders and on-ground agents.
- See account balances and money calculations.
- Set commissions for on-ground agents.
- Set commissions for traders.
- Set package/pricing rules if needed.

### On-ground Agent

The on-ground agent should be able to:

- Receive SIM cards from the on-ground manager.
- Hold SIM stock.
- Sell directly to end customers.
- Create trader accounts.
- Assign SIM cards to traders.
- See trader stock and sales.
- Deliver more SIM cards to traders when they request more.
- Earn commission based on sales/distribution rules.

### Trader / Small Business

The trader should be able to:

- Log in using an account created by the on-ground agent.
- See assigned SIM cards.
- Sell SIM cards to end customers.
- Select the package / baqa at the time of sale.
- Submit requests for more SIM cards.
- See their commission and balance.

When an on-ground agent creates a trader, the form should collect:

- Trader name / اسم التاجر
- Owner name / اسم المالك
- City / المدينة
- Region or district / المنطقة
- Location on map / الموقع على الخريطة
- Email / البريد الإلكتروني
- Password / الباسوورد
- Mobile number / رقم الجوال
- Place photo / صورة المكان

Professional recommendation:

- The map location should store latitude and longitude, plus an optional readable address.
- The place photo should be stored as an uploaded attachment linked to the trader.
- The trader account should remain tied to the creating on-ground agent.
- The manager should be able to see the trader, owner, map location, photo, assigned agent, stock, sales, and payment history.

## Important Decision: SIM vs Package

The physical SIM card and the package are not the same thing.

We will use the second model:

```text
SIM card is physical stock.
Package / baqa is selected when the SIM is sold.
```

Example:

```text
SIM #12345 is assigned to Trader A.
Trader A sells it to a customer.
At sale time, Trader A selects "Baqah 150".
The sale records:
  - SIM #12345
  - Package: Baqah 150
  - Seller: Trader A
  - Owning on-ground agent
  - Sale price
  - Trader commission
  - On-ground agent commission
```

This is more flexible than tying every SIM to a package before sale.

## Core Data Model Idea

### SIM Unit

Represents the physical SIM card.

Possible data:

- SIM serial / ICCID
- Phone number if available
- Current status
- Current on-ground agent
- Current trader
- Sold date
- Sold by agent/trader

SIM status examples:

- In stock
- With on-ground agent
- With trader
- Sold
- Returned

### Package / Baqa

Represents the sellable telecom package.

Possible data:

- Provider, such as Virgin
- Package name, such as Baqah 110
- Internet allowance
- Minutes allowance
- Validity period
- Base price
- Discounted sale price
- Tax included or not
- Active/inactive

### Sale

Represents the business event when a SIM is sold.

A sale should connect:

- SIM unit
- Selected package
- Seller type: on-ground agent or trader
- Seller id
- Owning on-ground agent
- Customer details if needed
- Sale price
- Commission rules used
- Trader commission amount
- On-ground agent commission amount
- Created date

Trader selling experience should be simple and similar to the normal sales-agent interface:

- Big package cards / boxes.
- Easy inputs.
- Minimal steps.
- Mobile-first layout.
- Clear balance and commission feedback after sale.

Recommended sale flow:

```text
Trader opens Sell SIM.
Trader selects or scans one SIM from their available stock.
Trader selects the package / baqa card.
System shows sale price, trader commission, and amount owed.
Trader confirms customer sale.
Sale is recorded on the trader account.
Commission and balance are calculated automatically.
```

Important:

- The sale belongs to the trader.
- The sale is also linked to the owning on-ground agent.
- The selected package controls price and commission logic.

## Commission Direction

Current discussion direction:

- Trader earns commission when they sell.
- On-ground agent earns commission from the sale/distribution chain.
- The package selected at sale time may affect both commissions.
- On-ground manager sets the commission rules.

Possible commission rule types:

- Flat amount per package.
- Percentage of sale price.
- Different rates per trader.
- Different rates per on-ground agent.
- Different rates per package.

We need to decide the final rule structure.

## Money & Balance Questions

Open discussion points:

- Does the trader owe the agent only after the SIM is sold?
My Answer: Yes
- Does the agent owe the organization only after the SIM is sold?
My Answer: Yes
- Are commissions paid immediately, weekly, monthly, or marked as unpaid until collected?
My Answer: weekly
- Do we need cash collection records for both trader -> agent and agent -> organization?
My Answer: Yes
Current likely direction:

```text
Money crystallizes on sale, not on handover.
```

That means assigning SIMs does not create debt by itself. Selling the SIM with a package creates the money/commission event.

## Trader Payment Flow

After the trader sells SIMs/packages, the trader owes money to the on-ground agent according to the calculated balance.

The trader can choose how to pay the on-ground agent:

### Cash Payment

Cash scenario:

```text
Trader enters payment amount.
Trader selects "cash".
Trader submits the cash payment record.
System marks it as pending agent confirmation.
On-ground agent receives a notification/request.
On-ground agent confirms the cash was received.
System marks the payment as confirmed.
Trader balance is reduced only after confirmation.
```

Professional recommendation:

- Cash should not reduce the trader balance immediately.
- Cash should create a pending collection request.
- The on-ground agent must confirm receipt.
- The system should record who submitted it, who confirmed it, and timestamps for both.

### Visa / Electronic Payment

Visa scenario:

```text
Trader enters payment amount.
Trader selects "visa" or electronic payment.
Trader uploads payment screenshot.
Trader submits the payment proof.
System marks it as pending review/confirmation.
On-ground agent manager reviews the screenshot.
On-ground agent manager confirms or rejects the payment.
System reduces the trader balance only when confirmed.
```

Professional recommendation:

- Use a more general label like "Electronic payment" if this may include Visa, bank transfer, wallet, or POS.
- Store the screenshot as a payment attachment.
- Allow the on-ground agent to reject with a reason.
- Keep pending, confirmed, and rejected payment states.

Suggested payment statuses:

- Pending confirmation
- Confirmed
- Rejected

Suggested payment data:

- Trader id
- On-ground agent id
- Amount
- Payment method: cash, visa/electronic
- Screenshot attachment if electronic
- Notes
- Submitted by
- Submitted at
- Confirmed/rejected by
- Confirmed/rejected at
- Rejection reason

## SIM Delivery From Agent To Trader

The current checkbox selection flow is useful, but the client wants the agent to enter only the quantity of SIMs to deliver.

Recommended professional flow:

```text
On-ground agent opens Deliver SIMs to Trader.
Agent selects trader.
Agent enters quantity, for example 5.
System automatically selects the next available 5 SIMs from the agent's stock.
System displays the selected SIM data before final submit.
Agent reviews the SIM list.
Agent confirms delivery.
System transfers those SIMs to the trader.
```

This gives speed and control:

- The agent does not manually search through every SIM.
- The SIM data still appears before delivery.
- The agent can review what will be delivered.
- The system keeps exact inventory tracking.

Best default selection rule:

```text
Oldest assigned SIMs first.
```

Alternative selection options for later:

- Oldest assigned first.
- Newest assigned first.
- By SIM type/provider.
- Manual override.
- Scan SIM barcode/ICCID.

Recommended delivery screen:

- Select trader.
- Enter quantity.
- Optional filter by SIM type/provider.
- Preview selected SIMs.
- Confirm delivery.

Preview should show:

- SIM type, such as prepaid.
- ICCID / serial.
- Phone number if available.
- Current status.
- Optional package compatibility/provider.

Important rule:

- The agent should only deliver SIMs that are currently in their own stock.
- Delivered SIMs move from `with_agent` to `with_trader`.
- The transfer record should include quantity and the exact SIM ids.

## Reports Needed

The system should eventually show:

- Best on-ground agent by sales count.
- Best on-ground agent by revenue.
- Best on-ground agent by trader network performance.
- Best trader by sales count.
- Best trader by revenue.
- Best trader by package mix.
- Best-selling packages.
- Unsold SIM stock by manager/agent/trader.
- Sold SIMs by package.
- Trader balances.
- On-ground agent balances.
- Unpaid commissions.
- Paid commissions.

## UX Direction

### On-ground Manager Dashboard

Expected areas:

- Overview
- SIM stock
- On-ground agents
- Traders
- Packages / الباقات
- Sales
- Commissions
- Cash collections
- Reports

### On-ground Agent Kiosk

Expected areas:

- My SIMs
- My traders
- Assign SIMs to trader
- Sell SIM directly
- Trader requests
- My commission
- My balance

### Trader Kiosk

Expected areas:

- My SIMs
- Sell SIM
- Select package
- Request more SIMs
- My commission
- My balance

## Open Questions

1. Do packages belong to one provider only, such as Virgin, or will there be multiple providers?
Make it virgin only for now
2. Does every SIM have a provider before sale?
yes
3. Can any package be sold on any SIM, or must the package match the SIM provider?
must
4. Does the package price come from the system, or can the trader type a custom sale price?
come from the system
5. Are commissions set globally, per package, per agent, per trader, or a mix?
per package
6. Do we need approval before a trader sale is final?
no
7. Do we need customer identity/KYC details for every SIM sale?
no
8. Can a trader return unsold SIMs?
no
9. Can an on-ground agent transfer SIMs between traders?
no
10. Can an on-ground agent transfer SIMs back to manager stock?
no
## Decisions So Far

- On-ground agent manager is separate from HR.
- Normal sales agents and on-ground agents are different concepts.
- SIM is physical stock.
- Package / baqa is selected at sale time.
- Traders record their own sales.
- Trader and on-ground agent commissions must both be calculated.
- The system must report best traders/resellers and best on-ground agents.
- v52 adds manager-only SIM Box OCR Import for stock intake: uploaded box images are reviewed, kit codes are generated server-side, and confirmed SIMs enter stock or direct field-agent assignment without changing sale flow.

## Parking Lot

Ideas to discuss later:

- Package import from telecom provider lists.
- Barcode/QR scanning for SIM assignment and sale. SIM box OCR import is now implemented for manager stock intake only.
- Mobile-first trader selling screen.
- Geo-location for on-ground agent visits.
- Trader ranking leaderboard.
- Agent route/visit tracking.
- Package promotions and discounts.
- Commission payout batches.
