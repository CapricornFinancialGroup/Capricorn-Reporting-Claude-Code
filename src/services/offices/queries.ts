// Lake queries behind the Offices admin page.

import { combine, notDeleted, orgFilter, whereClause } from "../reporting/filters.js";
import type { BuiltQuery, SqlParam } from "../reporting/query.js";

export interface ActiveAdviser {
  username: string | null;
  fullName: string | null;
  /** Mortgage leads plus protection cases opened in the window: enough to say "this person is working". */
  cases: number;
  lastCase: string | null;
}

/** Same-named params from two fragments (orgFilter on two aliases binds @Org0, @Org1 twice) bound once. */
function uniqueParams(params: SqlParam[]): SqlParam[] {
  const seen = new Set<string>();
  return params.filter((p) => (seen.has(p.name) ? false : (seen.add(p.name), true)));
}

/** Every login that is the adviser on a Capricorn mortgage or protection case since `since`
 *  (YYYY-MM-DD). Protection is included because the board is: Michael Ngoka sat invisible under
 *  Unassigned with 78 protection cases until the card was widened past leads (2026-08-10). */
export function activeAdvisers(since: string): BuiltQuery {
  const m = combine(orgFilter("f"), notDeleted("f"), { clause: "f.LeadDate >= @Since", params: [] });
  const p = combine(orgFilter("p"), notDeleted("p"), { clause: "p.CreatedDate >= @Since", params: [] });
  return {
    text: `WITH act AS (
             SELECT f.PrimaryAdviserUserAccountKey AS k, f.LeadDate AS d FROM dbo.mortgagecase f ${whereClause(m)}
             UNION ALL
             SELECT p.PrimaryAdviserUserAccountKey, p.CreatedDate FROM dbo.protectioncase p ${whereClause(p)}
           )
           SELECT ua.Username AS username, ua.FullName AS fullName, COUNT(*) AS cases,
                  CONVERT(varchar(10), MAX(act.d), 23) AS lastCase
             FROM act JOIN dbo.useraccount ua ON ua.UserAccountKey = act.k
            GROUP BY ua.Username, ua.FullName;`,
    params: uniqueParams([...m.params, ...p.params, { name: "Since", value: since, kind: "date" }]),
  };
}

/** The Capricorn account behind a login, if there is one. A placement is only accepted for a login
 *  that exists: a mapping keyed on a name rather than a sign-in never matches (aran.purewal, the
 *  Shire Finance logins), and nothing on the board would show that it had not taken. */
export function capricornLogin(username: string): BuiltQuery {
  const org = orgFilter();
  return {
    text: `SELECT TOP 1 Username AS username, FullName AS fullName FROM dbo.useraccount
            WHERE ${org.clause} AND LOWER(Username) = @Login;`,
    params: [...org.params, { name: "Login", value: username.trim().toLowerCase(), kind: "nvarchar" }],
  };
}
