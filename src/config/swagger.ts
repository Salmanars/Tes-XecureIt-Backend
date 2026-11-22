import { Router } from "express";
import swaggerUi from "swagger-ui-express";

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Secure Document Sharing & Verification API",
    version: "1.0.0",
    description:
      "Authenticated document storage, role-based sharing, immutable audit records, and SHA-256 integrity verification.",
  },
  servers: [{ url: "/api", description: "API" }],
  tags: [
    { name: "Auth" },
    { name: "Documents" },
    { name: "Versions" },
    { name: "Collaboration" },
    { name: "Shares & invitations" },
    { name: "Verification" },
    { name: "Audit" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
      eventStreamToken: {
        type: "apiKey",
        in: "query",
        name: "token",
        description:
          "Short-lived (5 minute), document-scoped ticket from POST /documents/{id}/events/token. Do not use a regular access token in a URL.",
      },
    },
    parameters: {
      DocumentId: {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    },
    schemas: {
      Error: {
        type: "object",
        required: ["success", "error"],
        properties: {
          success: { type: "boolean", example: false },
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
      User: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          email: { type: "string", format: "email" },
          role: { $ref: "#/components/schemas/Role" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      AuthInput: {
        type: "object",
        required: ["email", "password"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100 },
          email: { type: "string", format: "email", maxLength: 254 },
          password: { type: "string", minLength: 8, maxLength: 128 },
        },
      },
      AuthResult: {
        type: "object",
        properties: {
          user: { $ref: "#/components/schemas/User" },
          token: { type: "string" },
        },
      },
      Document: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          ownerId: { type: "string", format: "uuid" },
          title: { type: "string" },
          description: { type: "string", nullable: true },
          filename: { type: "string" },
          mimeType: { type: "string" },
          size: { type: "integer" },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      Role: {
        type: "string",
        enum: ["OWNER", "EDITOR", "VIEWER"],
      },
      ShareInput: {
        type: "object",
        required: ["email", "role"],
        properties: {
          email: { type: "string", format: "email" },
          role: { $ref: "#/components/schemas/Role" },
        },
      },
      Upload: {
        type: "object",
        required: ["file"],
        properties: {
          file: {
            type: "string",
            format: "binary",
            description: "PDF, DOCX, TXT, or CSV; maximum size 10 MB.",
          },
          title: { type: "string", description: "Required when creating a document." },
          description: { type: "string" },
        },
      },
      EventStreamTicket: {
        type: "object",
        properties: {
          token: { type: "string" },
          tokenType: { type: "string", example: "Bearer" },
          expiresInSeconds: { type: "integer", example: 300 },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: "Missing, invalid, or expired authentication token.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      Forbidden: {
        description: "The authenticated user does not have the required document role.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      NotFound: {
        description: "The requested resource was not found.",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    },
  },
  paths: {
    "/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Register a user",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/AuthInput" } } },
        },
        responses: {
          "201": { description: "Registered user and access token." },
          "400": { description: "Invalid registration data." },
          "409": { description: "Email address is already registered." },
        },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Log in",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/AuthInput" } } },
        },
        responses: { "200": { description: "Authenticated user and access token." }, "401": { $ref: "#/components/responses/Unauthorized" } },
      },
    },
    "/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Get the current user",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Current user." }, "401": { $ref: "#/components/responses/Unauthorized" } },
      },
      patch: {
        tags: ["Auth"],
        summary: "Update the authenticated user's name and/or email",
        description: "Returns the updated user and a refreshed access token, including when the email changes.",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                minProperties: 1,
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 100 },
                  email: { type: "string", format: "email", maxLength: 254 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Updated user and refreshed access token." },
          "400": { description: "Invalid profile data." },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "409": { description: "Email address is already in use." },
        },
      },
    },
    "/auth/password": {
      patch: {
        tags: ["Auth"],
        summary: "Change the authenticated user's password",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["currentPassword", "newPassword", "confirmPassword"],
                properties: {
                  currentPassword: { type: "string", minLength: 8, maxLength: 128 },
                  newPassword: { type: "string", minLength: 8, maxLength: 128 },
                  confirmPassword: { type: "string", minLength: 8, maxLength: 128 },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Password changed." },
          "400": { description: "Invalid input or current password is incorrect." },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/documents": {
      get: {
        tags: ["Documents"],
        summary: "List documents available to the current user",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Document list." }, "401": { $ref: "#/components/responses/Unauthorized" } },
      },
      post: {
        tags: ["Documents"],
        summary: "Create a document and its first version",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: { "multipart/form-data": { schema: { $ref: "#/components/schemas/Upload" } } },
        },
        responses: { "201": { description: "Created document with server-computed hash and scan status." }, "413": { description: "File exceeds 10 MB." }, "415": { description: "Unsupported file or mismatched signature." } },
      },
    },
    "/documents/{id}": {
      parameters: [{ $ref: "#/components/parameters/DocumentId" }],
      get: {
        tags: ["Documents"],
        summary: "Get document metadata",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Document metadata." }, "401": { $ref: "#/components/responses/Unauthorized" }, "403": { $ref: "#/components/responses/Forbidden" }, "404": { $ref: "#/components/responses/NotFound" } },
      },
      patch: {
        tags: ["Documents"],
        summary: "Update document metadata (editor or owner)",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  description: { type: "string", nullable: true },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Updated document." }, "403": { $ref: "#/components/responses/Forbidden" } },
      },
      delete: {
        tags: ["Documents"],
        summary: "Delete a document (owner only)",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Deleted document." }, "403": { $ref: "#/components/responses/Forbidden" } },
      },
    },
    "/documents/{id}/status": {
      patch: {
        tags: ["Documents"],
        summary: "Set the document review status (owner only)",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/DocumentId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["status"],
                properties: {
                  status: { type: "string", enum: ["VERIFIED", "REJECTED", "REVOKED"] },
                  statusNote: { type: "string", nullable: true, maxLength: 1000 },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Updated review status." }, "403": { $ref: "#/components/responses/Forbidden" } },
      },
    },
    "/documents/{id}/download": {
      get: {
        tags: ["Documents"],
        summary: "Download the current document version",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/DocumentId" }],
        responses: { "200": { description: "Private file stream with attachment and nosniff headers." }, "403": { $ref: "#/components/responses/Forbidden" }, "404": { $ref: "#/components/responses/NotFound" }, "409": { description: "Download blocked because the owner has not approved the document." }, "423": { description: "Download blocked because the current version is infected." } },
      },
    },
    "/documents/{id}/versions": {
      get: {
        tags: ["Versions"],
        summary: "List document versions",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/DocumentId" }],
        responses: { "200": { description: "Version history, newest first." }, "403": { $ref: "#/components/responses/Forbidden" } },
      },
      post: {
        tags: ["Versions"],
        summary: "Upload a new document version (editor or owner)",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/DocumentId" }],
        requestBody: { required: true, content: { "multipart/form-data": { schema: { allOf: [{ $ref: "#/components/schemas/Upload" }, { type: "object", properties: { changeNote: { type: "string", maxLength: 500 } } }] } } } },
        responses: { "201": { description: "Created immutable version with server-computed SHA-256 hash and scan status." }, "403": { $ref: "#/components/responses/Forbidden" }, "413": { description: "File exceeds 10 MB." }, "415": { description: "Unsupported file or mismatched signature." } },
      },
    },
    "/documents/{id}/events/token": {
      post: {
        tags: ["Collaboration"],
        summary: "Issue a short-lived ticket for EventSource clients",
        description: "Use this document-scoped, five-minute token only as the `token` query parameter for the matching event stream. Standard access tokens are not accepted in query strings.",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/DocumentId" }],
        responses: { "201": { description: "Short-lived event stream token." }, "403": { $ref: "#/components/responses/Forbidden" } },
      },
    },
    "/documents/{id}/events": {
      get: {
        tags: ["Collaboration"],
        summary: "Subscribe to document presence and activity events",
        description: "Server-Sent Events. Authenticate with a bearer header or a scoped `token` query ticket, but not both. Emits `presence`, `activity`, and `access` events.",
        security: [{ bearerAuth: [] }, { eventStreamToken: [] }],
        parameters: [{ $ref: "#/components/parameters/DocumentId" }],
        responses: { "200": { description: "Event stream.", content: { "text/event-stream": { schema: { type: "string" } } } }, "401": { $ref: "#/components/responses/Unauthorized" }, "403": { $ref: "#/components/responses/Forbidden" } },
      },
      post: {
        tags: ["Collaboration"],
        summary: "Announce active or editing activity",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/DocumentId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["action"],
                properties: {
                  action: { type: "string", enum: ["active", "editing"] },
                },
              },
            },
          },
        },
        responses: { "202": { description: "Activity accepted. Editing requires editor or owner access." }, "403": { $ref: "#/components/responses/Forbidden" } },
      },
    },
    "/documents/{id}/shares": {
      get: {
        tags: ["Shares & invitations"],
        summary: "List document shares (editor or owner)",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/DocumentId" }],
        responses: { "200": { description: "Share list." }, "403": { $ref: "#/components/responses/Forbidden" } },
      },
      post: {
        tags: ["Shares & invitations"],
        summary: "Share with a registered user or invite by email",
        description: "Editors may grant editor/viewer roles. Only owners may assign owner access.",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/DocumentId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ShareInput" },
            },
          },
        },
        responses: { "200": { description: "Existing share updated." }, "201": { description: "Share created." }, "202": { description: "Invitation created and sent by email." }, "403": { $ref: "#/components/responses/Forbidden" }, "503": { description: "SMTP invitation delivery is not configured." } },
      },
    },
    "/documents/{id}/share-candidates": {
      get: {
        tags: ["Shares & invitations"],
        summary: "Search registered users for document access",
        description: "Returns up to 10 registered users matching a name or email. Users who already have access are excluded.",
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: "#/components/parameters/DocumentId" },
          { name: "q", in: "query", required: true, schema: { type: "string", minLength: 2, maxLength: 100 } },
        ],
        responses: { "200": { description: "Matching registered users." }, "400": { description: "Search must contain between 2 and 100 characters." }, "403": { $ref: "#/components/responses/Forbidden" } },
      },
    },
    "/documents/{id}/shares/{shareId}": {
      parameters: [
        { $ref: "#/components/parameters/DocumentId" },
        { name: "shareId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
      ],
      patch: {
        tags: ["Shares & invitations"],
        summary: "Change a share's role",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["role"],
                properties: { role: { $ref: "#/components/schemas/Role" } },
              },
            },
          },
        },
        responses: { "200": { description: "Updated share." }, "403": { $ref: "#/components/responses/Forbidden" }, "404": { $ref: "#/components/responses/NotFound" } },
      },
      delete: {
        tags: ["Shares & invitations"],
        summary: "Revoke a share",
        security: [{ bearerAuth: [] }],
        responses: { "200": { description: "Share revoked." }, "403": { $ref: "#/components/responses/Forbidden" }, "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/documents/{id}/invitations": {
      get: {
        tags: ["Shares & invitations"],
        summary: "List invitations (editor or owner)",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/DocumentId" }],
        responses: { "200": { description: "Invitation list." }, "403": { $ref: "#/components/responses/Forbidden" } },
      },
    },
    "/documents/{id}/invitations/{invitationId}": {
      delete: {
        tags: ["Shares & invitations"],
        summary: "Revoke a pending invitation",
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: "#/components/parameters/DocumentId" },
          { name: "invitationId", in: "path", required: true, schema: { type: "string", format: "uuid" } },
        ],
        responses: { "200": { description: "Invitation revoked." }, "403": { $ref: "#/components/responses/Forbidden" }, "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/invitations/accept": {
      post: {
        tags: ["Shares & invitations"],
        summary: "Accept an invitation while signed in with the invited email",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["token"],
                properties: { token: { type: "string" } },
              },
            },
          },
        },
        responses: { "200": { description: "Invitation accepted." }, "403": { description: "Signed-in email does not match the invite." }, "410": { description: "Invitation expired." } },
      },
    },
    "/documents/{id}/verify": {
      get: {
        tags: ["Verification"],
        summary: "Recompute and compare the current file's SHA-256 hash",
        security: [{ bearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/DocumentId" }],
        responses: { "200": { description: "Integrity result, including valid or mismatch status." }, "403": { $ref: "#/components/responses/Forbidden" }, "404": { $ref: "#/components/responses/NotFound" } },
      },
    },
    "/documents/{id}/audit": {
      get: {
        tags: ["Audit"],
        summary: "Read immutable audit history (read-only)",
        security: [{ bearerAuth: [] }],
        parameters: [
          { $ref: "#/components/parameters/DocumentId" },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "pageSize", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 25 } },
        ],
        responses: { "200": { description: "Paginated audit trail." }, "403": { $ref: "#/components/responses/Forbidden" } },
      },
    },
  },
} as const;

export const swaggerRouter = Router();

swaggerRouter.get("/openapi.json", (_request, response) => {
  response.status(200).json(openApiDocument);
});
swaggerRouter.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));
