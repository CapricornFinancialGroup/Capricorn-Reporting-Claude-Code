# GAGold_Capricorn — Capricorn Gold datalake share

Firm-scoped copy of the Smartr Gold reporting layer for **Capricorn Financial Group**,
covering both Capricorn firms on the platform. Built daily by the
`LoadGoldCapricornShare` notebook (this repo, `Fabric/ETLNotebooks/`). PBI 90576.

| | |
|---|---|
| Workspace | `GlobalAnalyticsShare` (`d578dae6-d186-4ff2-a775-83744a51bbed`) |
| Lakehouse | `GAGold_Capricorn` (`0718ff2f-7f29-450d-8ffe-cb553c190b1f`) |
| SQL endpoint | `t43woyvlppeu7nhsptsxhz7zwq-43nhrvmg2hze7j3vqn2euun35u.datawarehouse.fabric.microsoft.com` |
| Database | `GAGold_Capricorn` |
| Auth | Entra ID (B2B guest), Viewer on the workspace |
| Refresh | Daily, after the 23:00 UTC Gold load (schedule on the notebook) |

## Firms in scope

| OrganisationKey | OrgID | Firm | BusinessGUID |
|---|---|---|---|
| 411 | `1MEQ16C` | Capricorn Financial Consultancy | `d2827e74-692b-4cf6-a923-ac256d83b06a` |
| 486 | `1Q1M7BJ` | Capricorn Financial Mortgages Limited | `df9d278f-e047-492f-a30d-d75dc0faae80` |

Both firms land in the same tables. Filter/`GROUP BY` `OrganisationKey` (or join
`organisation` for the firm name) to split them.

## How the share is scoped

Every table is a filtered copy of prod `GAGold`:

1. Tables carrying `OrganisationKey` (case facts, org-owned dims) — filtered to the two
   OrganisationKeys above.
2. Tables carrying only `OrgID`/`_OrgID` (`userrole`, `client`) — filtered to the two OrgIDs.
3. Keyed dims with no org column (`address`, `mortgagedetail`, `propertydetails`,
   `protectiondetail`, `generalinsurancedetail`, `*caseuser`) — restricted to rows
   referenced by the firms' own cases (semi-join through the parent fact).
4. Global platform reference data (`lender`, `fee`, `protectionprovider`,
   `generalinsuranceprovider`, `factfindsection`) — copied whole (no firm content).
5. Withheld: `_offboard_audit` (internal ETL bookkeeping), `crossbrokerreferral`
   (references other brokerages). Any new Gold table that cannot be classified is
   withheld and logged until classified.

`vw_total_written_by_product` is re-materialised as a table from the scoped facts
(same shape and semantics as the GAGold warehouse view).

## Conventions

- `*YN` columns are `'Y'`/`'N'` text flags (occasionally empty when unknown).
- `*Key` columns are surrogate keys for joins within the share. Negative key values are
  "unknown" sentinels — they will not resolve against the dim; use outer joins.
- `_etl_created` / `_etl_modified` are pipeline timestamps, not business dates.
- `LeadDate` = date the lead was created in Smartr (`tbllead.created`). The legacy
  in-app CSV exports date-filter on the *client* added date, so daily counts can differ
  by ±1 day around midnight for boundary cases.
- Case facts are one row per **finance product**, not per lead. A lead with two mortgage
  products contributes two `mortgagecase` rows — use `COUNT(DISTINCT LeadId)` for
  lead-level counts (the example queries below do this).
- Exclude deleted cases with `COALESCE(DeletedYN, 'N') <> 'Y'`.

## Reproducing the standard Capricorn report pulls

Date placeholders use a Sat–Fri week; substitute daily/monthly ranges as needed.

### 1. Introducer Leads (Introducer Lead Table)

```sql
SELECT
    i.IntroducerCompany                       AS IntroducerName,
    neg.FullName                              AS NegotiatorName,
    i.IntroducerBranch                        AS BranchName,
    COUNT(DISTINCT mc.LeadId)                 AS TotalCount,
    COUNT(DISTINCT CASE WHEN mc.OfferQualifiedYN = 'Y' THEN mc.LeadId END) AS OfferQualified,
    CAST(100.0 * COUNT(DISTINCT mc.LeadId)
         / SUM(COUNT(DISTINCT mc.LeadId)) OVER () AS decimal(5, 2)) AS PercentageOfLeads
FROM dbo.mortgagecase mc
LEFT JOIN dbo.introducer  i   ON i.IntroducerKey     = mc.IntroducerKey
LEFT JOIN dbo.useraccount neg ON neg.UserAccountKey  = mc.NegotiatorUserAccountKey
WHERE mc.LeadDate >= '2026-06-27' AND mc.LeadDate < '2026-07-04'
  AND COALESCE(mc.DeletedYN, 'N') <> 'Y'
GROUP BY i.IntroducerCompany, neg.FullName, i.IntroducerBranch
ORDER BY TotalCount DESC;
```

Daily totals ("Number of Leads" CSV):

```sql
SELECT mc.LeadDate AS Created, COUNT(DISTINCT mc.LeadId) AS TotalLeads
FROM dbo.mortgagecase mc
WHERE mc.LeadDate >= '2026-06-27' AND mc.LeadDate < '2026-07-04'
  AND COALESCE(mc.DeletedYN, 'N') <> 'Y'
GROUP BY mc.LeadDate
ORDER BY Created;
```

### 2. All Adviser Leads (Adviser Leads CSV)

```sql
SELECT
    adv.FullName                              AS AdviserName,
    COUNT(DISTINCT mc.LeadId)                 AS TotalCount,
    COUNT(DISTINCT CASE WHEN mc.OfferQualifiedYN = 'Y' THEN mc.LeadId END) AS OfferQualified,
    CAST(100.0 * COUNT(DISTINCT mc.LeadId)
         / SUM(COUNT(DISTINCT mc.LeadId)) OVER () AS decimal(5, 2)) AS PercentageOfLeads
FROM dbo.mortgagecase mc
JOIN dbo.useraccount adv ON adv.UserAccountKey = mc.PrimaryAdviserUserAccountKey
WHERE mc.LeadDate >= '2026-06-27' AND mc.LeadDate < '2026-07-04'
  AND COALESCE(mc.DeletedYN, 'N') <> 'Y'
GROUP BY adv.FullName
ORDER BY TotalCount DESC;
```

### 3. Corporate Adviser Leads

Query 2 restricted to the corporate introducer list:

```sql
SELECT
    adv.FullName                              AS AdviserName,
    COUNT(DISTINCT mc.LeadId)                 AS TotalCount,
    COUNT(DISTINCT CASE WHEN mc.OfferQualifiedYN = 'Y' THEN mc.LeadId END) AS OfferQualified,
    CAST(100.0 * COUNT(DISTINCT mc.LeadId)
         / SUM(COUNT(DISTINCT mc.LeadId)) OVER () AS decimal(5, 2)) AS PercentageOfLeads
FROM dbo.mortgagecase mc
JOIN dbo.useraccount adv ON adv.UserAccountKey = mc.PrimaryAdviserUserAccountKey
JOIN dbo.introducer  i   ON i.IntroducerKey    = mc.IntroducerKey
WHERE mc.LeadDate >= '2026-06-27' AND mc.LeadDate < '2026-07-04'
  AND COALESCE(mc.DeletedYN, 'N') <> 'Y'
  AND i.IntroducerCompany IN (
      'Ballymore', 'Barratt', 'Benham & Reeves', 'Berkeley', 'Caplen Estates',
      'Chase Evans', 'Dexters', 'EA2', 'Fletchers', 'Frank Harris', 'Fraser & Co',
      'Jacksons Stops', 'Jacksons', 'Johns & Co', 'Keatons', 'LiFE',
      'Marsh & Parsons', 'Morelands', 'RSK', 'Snellers', 'Tatlers',
      'Waterview Estates', 'Wetherell'
  )
GROUP BY adv.FullName
ORDER BY TotalCount DESC;
```

(The IN-list must match `introducer.IntroducerCompany` exactly, and the data holds
several variants per introducer — e.g. `Ballymore` / `Ballymore Group`,
`Dexters` / `Dexters Hampstead` / `Dexters North`, `Jackson Stops` / `Jacksons Stretham`.
Run `SELECT DISTINCT IntroducerCompany FROM dbo.introducer ORDER BY 1` and curate the
list to the variants Capricorn's in-app "Corporate" filter selects, or switch to
prefix matching with `LIKE` patterns.)

### 4. All Adviser Applications (Mortgages Written)

```sql
SELECT
    adv.FullName            AS AdviserName,
    COUNT(*)                AS MortgagesWritten,
    SUM(mc.MortgageValue)   AS TotalMortgageValue
FROM dbo.mortgagecase mc
JOIN dbo.useraccount adv ON adv.UserAccountKey = mc.PrimaryAdviserUserAccountKey
WHERE mc.WrittenDate >= '2026-06-27' AND mc.WrittenDate < '2026-07-04'
  AND COALESCE(mc.DeletedYN, 'N') <> 'Y'
GROUP BY adv.FullName
ORDER BY TotalMortgageValue DESC;
```

### 5. Written Report (Total Written by product)

```sql
SELECT
    AdviserName,
    SUM(MortgageWritten)          AS MortgageWritten,
    SUM(ProtectionWritten)        AS ProtectionWritten,
    SUM(BuildingsContentsWritten) AS BuildingsContentsWritten
FROM dbo.vw_total_written_by_product
WHERE WrittenDate >= '2026-06-27' AND WrittenDate < '2026-07-04'
GROUP BY AdviserName
ORDER BY MortgageWritten DESC;
```

## Table catalogue

Case facts (`mortgagecase`, `protectioncase`, `generalinsurancecase`) are one row per
product; `*caseclient` bridges list all applicants; `*casestatushistory` is the status
audit trail; `*casefee` the fee lines; `*caseuser` the users attached to a case.

### Facts

- **`mortgagecase`** — mortgage products. Grain: one row per mortgage product on a lead.
  Key dates: `LeadDate`, `CreatedDate`, `WrittenDate`, `CompletionDate`, `OfferIssueDate`,
  plus per-workflow-status timestamps (`WorkflowStatus*Date`). Money: `MortgageValue`,
  `PurchasePrice`, `DepositAmount`, commission + fee columns. Flags: `OfferQualifiedYN`,
  `DeletedYN`, `NotProceedingYN`, `JointApplicationYN`. Joins: `PrimaryAdviserUserAccountKey`
  / `NegotiatorUserAccountKey` → `useraccount`; `IntroducerKey` → `introducer`;
  `LenderKey` → `lender`; `MortgageDetailKey` / `PropertyDetailsKey` / `AddressKey` /
  `PrimaryClientKey` → respective dims; `GlobalCaseID` → bridges + sibling cases.
- **`protectioncase`** — protection products; `ProtectionPolicyAmount`, `WrittenDate`,
  provider via `ProtectionProviderKey`.
- **`generalinsurancecase`** — home insurance (B&C); `BuildingsAmount`,
  `ContentsCoverAmount`, `ApplicationDate` (no written date — "written" ≈ submitted).
- **`vw_total_written_by_product`** — pre-built union for the Total Written report:
  `OrganisationKey, AdviserName, WrittenDate, MortgageWritten, ProtectionWritten,
  BuildingsContentsWritten`.
- **`additionalfinancecase`**, **`benefit`**, **`crosssellreferral`**,
  **`lendersubmission`**, **`thirdpartysubmission`**, **`identityverification`**,
  **`factfindcompletion`** — supporting facts (further advances, protection benefits,
  cross-sell referrals, DIP/full submissions, third-party submissions, Yoti checks,
  fact-find completion).

### Dims

- **`useraccount`** — advisers/negotiators/staff: `UserAccountKey`, `FullName`,
  `Username`, `Phone`.
- **`introducer`** — `IntroducerKey`, `IntroducerCompany`, `IntroducerBranch`,
  `IntroducerAccountType`.
- **`client`** — firm's clients: names, contact details, `ClientKey`/`ClientId`.
- **`organisation`** — the two Capricorn firm rows.
- **`lender`**, **`fee`**, **`protectionprovider`**, **`generalinsuranceprovider`**,
  **`factfindsection`** — global reference lists.
- **`mortgagedetail`**, **`propertydetails`**, **`address`**, **`protectiondetail`**,
  **`generalinsurancedetail`** — per-case detail dims (product type, buyer type,
  property attributes, …).
- **`userrole`** — per-user admin flags (`IsAdminYN`, `AdminRoles`).

Full column lists: query `INFORMATION_SCHEMA.COLUMNS` on the share SQL endpoint.
