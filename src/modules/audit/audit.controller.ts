import { z } from "zod";
import { asyncHandler } from "../../utils/async-handler";
import { listAuditEntries } from "./audit.service";

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const listAuditEntriesController = asyncHandler(async (request, response) => {
  const { page, pageSize } = paginationSchema.parse(request.query);
  const result = await listAuditEntries(request.params.id, page, pageSize);
  response.status(200).json({ success: true, data: result });
});
