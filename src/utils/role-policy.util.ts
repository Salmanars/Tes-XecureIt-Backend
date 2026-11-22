import { DocumentRole, Role } from "@prisma/client";
import { HttpError } from "../middlewares/error.middleware";

type AccessRole = DocumentRole | Role;

function roleRank(role: AccessRole): number {
  switch (role.toString()) {
    case "OWNER":
      return 3;
    case "EDITOR":
      return 2;
    case "VIEWER":
      return 1;
    default:
      throw new Error(`Unsupported access role: ${role.toString()}`);
  }
}

export function roleAtLeast(
  currentRole: AccessRole,
  requiredRole: AccessRole,
): boolean {
  return roleRank(currentRole) >= roleRank(requiredRole);
}

export function effectiveDocumentRole(
  userRole: Role,
  documentRole: DocumentRole,
): DocumentRole {
  if (!roleAtLeast(documentRole, userRole)) {
    return documentRole;
  }
  switch (userRole) {
    case Role.OWNER:
      return DocumentRole.OWNER;
    case Role.EDITOR:
      return DocumentRole.EDITOR;
    case Role.VIEWER:
      return DocumentRole.VIEWER;
    default:
      throw new Error("Unsupported account role");
  }
}

export function assertCanGrantRole(
  actorRole: DocumentRole,
  requestedRole: DocumentRole,
): void {
  if (requestedRole === DocumentRole.OWNER && actorRole !== DocumentRole.OWNER) {
    throw new HttpError(
      403,
      "OWNER_ROLE_REQUIRED",
      "Only a document owner can assign the owner role",
    );
  }
}

export function mostPrivilegedRole(
  firstRole: DocumentRole,
  secondRole: DocumentRole,
): DocumentRole {
  return roleAtLeast(firstRole, secondRole) ? firstRole : secondRole;
}

export function assertCanManageAssignedRole(
  actorRole: DocumentRole,
  assignedRole: DocumentRole,
): void {
  if (assignedRole === DocumentRole.OWNER && actorRole !== DocumentRole.OWNER) {
    throw new HttpError(
      403,
      "FORBIDDEN",
      "Only an owner can change another owner's role",
    );
  }
}
