import "./StateBadge.css";

import { t } from "../../../../services/i18n";
import { Badge } from "../../../react/Badge";

/**
 * Enabled/disabled status badge for a row whose control does not itself show the current state —
 * a green outline while the thing is on, red once it is off. It earns its place next to an
 * action button, whose verb is the inverse of the state ("Disable" while enabled); a toggle
 * already conveys its own state, so don't add one there. Wrap it in a `.state-badge-title` span
 * to sit inline after a row label.
 */
export default function StateBadge({ enabled }: { enabled: boolean }) {
    return (
        <Badge
            className={`state-badge ${enabled ? "active" : "inactive"}`}
            text={t(enabled ? "options.state_enabled" : "options.state_disabled")}
            outline
        />
    );
}
