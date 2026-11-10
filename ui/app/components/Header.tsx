import React from "react";
import { Link } from "react-router-dom";
import { AppHeader } from "@dynatrace/strato-components/layouts";
import { getAppVersion } from "@dynatrace-sdk/app-environment";

const appVersion = getAppVersion();
const APP_VERSION = appVersion.startsWith("dt.missing") ? "dev" : appVersion;

export const Header = () => {
  return (
    <AppHeader>
      <AppHeader.Navigation>
        <AppHeader.Logo as={Link} to="/blast-radius" />
        <AppHeader.NavigationItem as={Link} to="/blast-radius">
          Blast radius
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={Link} to="/topology">
          Topology
        </AppHeader.NavigationItem>
        <AppHeader.NavigationItem as={Link} to="/starfield">
          Starfield
        </AppHeader.NavigationItem>
      </AppHeader.Navigation>
      <AppHeader.ActionItems>
        <span className="version-badge">v{APP_VERSION}</span>
      </AppHeader.ActionItems>
    </AppHeader>
  );
};
