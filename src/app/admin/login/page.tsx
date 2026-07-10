import { Suspense } from "react";

import LoginClient from "./LoginClient";

export default function AdminLoginPage() {
  return (
    <Suspense>
      <LoginClient />
    </Suspense>
  );
}
