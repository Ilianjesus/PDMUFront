import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import {
  ELEMENT_ASSET_JOB_EVENT,
  processPendingElementAssetJobs,
} from "../services/elementAssetsService";
import "../styles/AuthenticatedShell.css";

export function AuthenticatedShell() {
  const { operatorProfile, profileStatus } = useAuth();

  useEffect(() => {
    if (
      profileStatus !== "ready" ||
      operatorProfile?.role !== "admin"
    ) {
      return undefined;
    }

    const processJobs = () => {
      void processPendingElementAssetJobs();
    };
    const handleVisibility = () => {
      if (document.visibilityState === "visible") processJobs();
    };

    processJobs();
    window.addEventListener(ELEMENT_ASSET_JOB_EVENT, processJobs);
    document.addEventListener("visibilitychange", handleVisibility);
    const intervalId = window.setInterval(processJobs, 30_000);

    return () => {
      window.removeEventListener(ELEMENT_ASSET_JOB_EVENT, processJobs);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearInterval(intervalId);
    };
  }, [operatorProfile?.role, profileStatus]);

  return (
    <div className="authenticated-shell">
      <Outlet />
    </div>
  );
}
