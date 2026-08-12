import type { OAuthStatus } from "@triliumnext/commons";

import { t } from "../services/i18n";
import { oauthAccountLabel, oauthProviderDisplayName } from "../services/oauth_status";
import { reconcileEnabledPackageActivations } from "../services/package_activation";
import server from "../services/server";
import toast from "../services/toast";
import Component from "./component";

// TODO: Deduplicate.
interface CpuArchResponse {
    isCpuArchMismatch: boolean;
}

export class StartupChecks extends Component {

    constructor() {
        super();
        this.checkCpuArchMismatch();
        // Shared by desktop and mobile (both reach here via appContext.start), so the post-enrollment
        // toast lives here rather than being duplicated in each entry point.
        showOAuthEnrollmentResultToast();
    }

    async checkCpuArchMismatch() {
        try {
            const response = await server.get("system-checks") as CpuArchResponse;
            if (response.isCpuArchMismatch) {
                this.triggerCommand("showCpuArchWarning", {});
            }
        } catch (error) {
            console.warn("Could not check CPU arch status:", error);
        }
    }
}

export async function reconcilePackageActivationsAtStartup() {
    try {
        const repairs = await reconcileEnabledPackageActivations();
        if (repairs.length) console.info("Repaired activation state for enabled community packages.", repairs);
    } catch (error) {
        // Startup must remain available if a package is mid-transaction or the
        // account cannot write notes. The Plugins screen will still report the
        // activation mismatch and offer repair.
        console.warn("Could not reconcile community package activation state:", error);
    }
}

/**
 * Shows a one-shot toast reporting the outcome of an OAuth provider round-trip once it redirects back
 * to the app root (which drops the Settings modal): "account connected" on success, or a failure notice
 * when the provider couldn't be reached at all. Both signals ride in the server's bootstrap payload
 * (`window.glob.oauthJustEnrolled` / `oauthConnectionFailed`, set once server-side and cleared by
 * /bootstrap), so nothing has to be stored on the client across the redirect.
 */
export async function showOAuthEnrollmentResultToast() {
    const connectionFailure = window.glob?.oauthConnectionFailed;
    if (connectionFailure) {
        // The provider couldn't be reached at all, so there is no account to name. The server's technical
        // detail (TLS trust, DNS, refused connection, …) is shown verbatim in monospace beneath the
        // heading — it names the actual cause, which a generic "check the log" message never could.
        toast.showErrorTitleAndMessage(
            t("multi_factor_authentication.oauth_connect_failed"),
            connectionFailure,
            15_000,
            { monospace: true }
        );
        return;
    }

    if (!window.glob?.oauthJustEnrolled) {
        return;
    }

    try {
        const status = await server.get<OAuthStatus>("oauth/status");
        toast.showMessage(t("multi_factor_authentication.oauth_connect_success", {
            account: oauthAccountLabel(status),
            provider: oauthProviderDisplayName(status)
        }));
    } catch {
        // Couldn't resolve the account details — still confirm the connection generically.
        toast.showMessage(t("multi_factor_authentication.oauth_connect_success_generic"));
    }
}
