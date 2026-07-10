import { Suspense } from "react";

import MaintenanceClient from "./MaintenanceClient";

export default function MaintenancePage() {
  return (
    <Suspense>
      <MaintenanceClient />
    </Suspense>
  );
}
