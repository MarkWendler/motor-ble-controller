import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  setLocation("/"); // Redirect to home page immediately (Workaround of sub routing issue)
  return (null);
}
