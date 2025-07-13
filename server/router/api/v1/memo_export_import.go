package v1

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/pkg/errors"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/runner/memopayload"
	"github.com/usememos/memos/store"
)

// ExportFormat represents the format for export/import operations
type ExportFormat string

const (
	FormatJSON ExportFormat = "json"
)

// ExportData represents the structure of exported data
type ExportData struct {
	Version    string       `json:"version"`
	ExportedAt time.Time    `json:"exported_at"`
	Memos      []ExportMemo `json:"memos"`
}

// ExportMemo represents a memo in the export format
type ExportMemo struct {
	UID         string               `json:"uid"`
	Content     string               `json:"content"`
	Visibility  string               `json:"visibility"`
	Pinned      bool                 `json:"pinned"`
	CreatedAt   time.Time            `json:"created_at"`
	UpdatedAt   time.Time            `json:"updated_at"`
	DisplayTime *time.Time           `json:"display_time,omitempty"`
	Tags        []string             `json:"tags,omitempty"`
	Location    *ExportLocation      `json:"location,omitempty"`
	Attachments []ExportAttachment   `json:"attachments,omitempty"`
	Relations   []ExportMemoRelation `json:"relations,omitempty"`
}

// ExportLocation represents location data in export format
type ExportLocation struct {
	Placeholder string  `json:"placeholder,omitempty"`
	Latitude    float64 `json:"latitude,omitempty"`
	Longitude   float64 `json:"longitude,omitempty"`
}

// ExportAttachment represents attachment data in export format
type ExportAttachment struct {
	UID      string `json:"uid"`
	Filename string `json:"filename"`
	Type     string `json:"type"`
	Size     int64  `json:"size"`
}

// ExportMemoRelation represents memo relations in export format
type ExportMemoRelation struct {
	RelatedMemoUID string `json:"related_memo_uid"`
	Type           string `json:"type"`
}

// ExportMemos exports memos for the current user in JSON format
func (s *APIV1Service) ExportMemos(ctx context.Context, request *v1pb.ExportMemosRequest) (*v1pb.ExportMemosResponse, error) {
	user, err := s.GetCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user")
	}

	// Validate format (default to JSON)
	format := request.Format
	if format == "" {
		format = string(FormatJSON)
	}
	if format != string(FormatJSON) {
		return nil, status.Errorf(codes.InvalidArgument, "unsupported export format: %s", format)
	}

	// Get all memos for the user
	memoFind := &store.FindMemo{
		CreatorID:       &user.ID,
		ExcludeComments: true,
	}

	// Apply filters if specified
	if request.Filter != "" {
		// Use existing filter validation from shortcut service
		memoFind.Filter = &request.Filter
	}

	// Include archived memos if requested
	if request.ExcludeArchived {
		normalStatus := store.Normal
		memoFind.RowStatus = &normalStatus
	}

	memos, err := s.Store.ListMemos(ctx, memoFind)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to list memos: %v", err)
	}

	// Convert memos to export format
	exportMemos := make([]ExportMemo, 0, len(memos))
	for _, memo := range memos {
		exportMemo, err := s.convertMemoToExport(ctx, memo, request.IncludeAttachments, request.IncludeRelations)
		if err != nil {
			slog.Warn("Failed to convert memo to export format", slog.Any("memo_id", memo.ID), slog.Any("error", err))
			continue
		}
		exportMemos = append(exportMemos, *exportMemo)
	}

	// Create export data structure
	exportData := &ExportData{
		Version:    "1.0",
		ExportedAt: time.Now(),
		Memos:      exportMemos,
	}

	// Serialize to JSON
	jsonData, err := json.MarshalIndent(exportData, "", "  ")
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to marshal export data: %v", err)
	}

	return &v1pb.ExportMemosResponse{
		Data:      jsonData,
		Format:    format,
		Filename:  fmt.Sprintf("memos_export_%s.json", time.Now().Format("20060102_150405")),
		MemoCount: int32(len(exportMemos)),
		SizeBytes: int64(len(jsonData)),
	}, nil
}

// ImportMemos imports memos from JSON data
func (s *APIV1Service) ImportMemos(ctx context.Context, request *v1pb.ImportMemosRequest) (*v1pb.ImportMemosResponse, error) {
	startTime := time.Now()

	user, err := s.GetCurrentUser(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "failed to get current user")
	}

	// Validate format (default to JSON)
	format := request.Format
	if format == "" {
		format = string(FormatJSON)
	}
	if format != string(FormatJSON) {
		return nil, status.Errorf(codes.InvalidArgument, "unsupported import format: %s", format)
	}

	// Parse the JSON data
	var importData ExportData
	if err := json.Unmarshal(request.Data, &importData); err != nil {
		return nil, status.Errorf(codes.InvalidArgument, "failed to parse import data: %v", err)
	}

	// Validate import data version
	if importData.Version != "1.0" {
		return nil, status.Errorf(codes.InvalidArgument, "unsupported import data version: %s", importData.Version)
	}

	var importedCount int32
	var skippedCount int32
	var createdCount int32
	var updatedCount int32
	var validationErrors int32
	var attachmentsImported int32
	var relationsImported int32
	var errors []string
	var warnings []string

	// Import each memo
	for _, exportMemo := range importData.Memos {
		result, err := s.importSingleMemo(ctx, user.ID, &exportMemo, request)
		if err != nil {
			errorMsg := fmt.Sprintf("Failed to import memo %s: %v", exportMemo.UID, err)
			errors = append(errors, errorMsg)
			skippedCount++
			if request.ValidateOnly {
				validationErrors++
			}
			slog.Warn("Failed to import memo", slog.String("uid", exportMemo.UID), slog.Any("error", err))
			continue
		}

		importedCount++
		if result.Created {
			createdCount++
		} else {
			updatedCount++
		}
		attachmentsImported += result.AttachmentsImported
		relationsImported += result.RelationsImported

		if len(result.Warnings) > 0 {
			warnings = append(warnings, result.Warnings...)
		}
	}

	duration := time.Since(startTime)

	summary := &v1pb.ImportSummary{
		TotalMemos:          int32(len(importData.Memos)),
		CreatedCount:        createdCount,
		UpdatedCount:        updatedCount,
		AttachmentsImported: attachmentsImported,
		RelationsImported:   relationsImported,
		DurationMs:          duration.Milliseconds(),
	}

	return &v1pb.ImportMemosResponse{
		ImportedCount:    importedCount,
		SkippedCount:     skippedCount,
		ValidationErrors: validationErrors,
		Errors:           errors,
		Warnings:         warnings,
		Summary:          summary,
	}, nil
}

// convertMemoToExport converts a store memo to export format
func (s *APIV1Service) convertMemoToExport(ctx context.Context, memo *store.Memo, includeAttachments, includeRelations bool) (*ExportMemo, error) {
	exportMemo := &ExportMemo{
		UID:        memo.UID,
		Content:    memo.Content,
		Visibility: memo.Visibility.String(),
		Pinned:     memo.Pinned,
		CreatedAt:  time.Unix(memo.CreatedTs, 0),
		UpdatedAt:  time.Unix(memo.UpdatedTs, 0),
	}

	// Extract tags from payload
	if memo.Payload != nil && len(memo.Payload.Tags) > 0 {
		exportMemo.Tags = memo.Payload.Tags
	}

	// Add location if present
	if memo.Payload != nil && memo.Payload.Location != nil {
		exportMemo.Location = &ExportLocation{
			Placeholder: memo.Payload.Location.Placeholder,
			Latitude:    memo.Payload.Location.Latitude,
			Longitude:   memo.Payload.Location.Longitude,
		}
	}

	// Add attachments if requested
	if includeAttachments {
		attachments, err := s.Store.ListAttachments(ctx, &store.FindAttachment{MemoID: &memo.ID})
		if err != nil {
			return nil, errors.Wrap(err, "failed to list attachments")
		}

		for _, attachment := range attachments {
			exportMemo.Attachments = append(exportMemo.Attachments, ExportAttachment{
				UID:      attachment.UID,
				Filename: attachment.Filename,
				Type:     attachment.Type,
				Size:     attachment.Size,
			})
		}
	}

	// Add relations if requested
	if includeRelations {
		relations, err := s.Store.ListMemoRelations(ctx, &store.FindMemoRelation{MemoID: &memo.ID})
		if err != nil {
			return nil, errors.Wrap(err, "failed to list memo relations")
		}

		for _, relation := range relations {
			relatedMemo, err := s.Store.GetMemo(ctx, &store.FindMemo{ID: &relation.RelatedMemoID})
			if err != nil || relatedMemo == nil {
				continue // Skip if related memo not found
			}

			exportMemo.Relations = append(exportMemo.Relations, ExportMemoRelation{
				RelatedMemoUID: relatedMemo.UID,
				Type:           string(relation.Type),
			})
		}
	}

	return exportMemo, nil
}

// ImportResult represents the result of importing a single memo
type ImportResult struct {
	Created             bool
	AttachmentsImported int32
	RelationsImported   int32
	Warnings            []string
}

// importSingleMemo imports a single memo
func (s *APIV1Service) importSingleMemo(ctx context.Context, userID int32, exportMemo *ExportMemo, request *v1pb.ImportMemosRequest) (*ImportResult, error) {
	result := &ImportResult{
		Warnings: []string{},
	}

	// Check if memo with this UID already exists
	existingMemo, err := s.Store.GetMemo(ctx, &store.FindMemo{UID: &exportMemo.UID})
	if err != nil {
		return nil, errors.Wrap(err, "failed to check for existing memo")
	}

	if existingMemo != nil && !request.OverwriteExisting {
		return nil, fmt.Errorf("memo with UID %s already exists", exportMemo.UID)
	}

	// Validate memo content length
	contentLengthLimit, err := s.getContentLengthLimit(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "failed to get content length limit")
	}
	if len(exportMemo.Content) > contentLengthLimit {
		return nil, fmt.Errorf("content too long (max %d characters)", contentLengthLimit)
	}

	// Parse visibility
	visibility := store.Private
	switch exportMemo.Visibility {
	case "PUBLIC":
		visibility = store.Public
	case "PROTECTED":
		visibility = store.Protected
	case "PRIVATE":
		visibility = store.Private
	default:
		result.Warnings = append(result.Warnings, fmt.Sprintf("Unknown visibility %s for memo %s, defaulting to PRIVATE", exportMemo.Visibility, exportMemo.UID))
	}

	// Create memo payload
	payload := &storepb.MemoPayload{
		Tags: exportMemo.Tags,
	}

	if exportMemo.Location != nil {
		payload.Location = &storepb.MemoPayload_Location{
			Placeholder: exportMemo.Location.Placeholder,
			Latitude:    exportMemo.Location.Latitude,
			Longitude:   exportMemo.Location.Longitude,
		}
	}

	// Set timestamps
	createdTs := exportMemo.CreatedAt.Unix()
	updatedTs := exportMemo.UpdatedAt.Unix()
	if !request.PreserveTimestamps {
		now := time.Now().Unix()
		createdTs = now
		updatedTs = now
	}

	if request.ValidateOnly {
		// Just validate, don't actually create/update
		return result, nil
	}

	if existingMemo != nil {
		// Update existing memo
		update := &store.UpdateMemo{
			ID:         existingMemo.ID,
			Content:    &exportMemo.Content,
			Visibility: &visibility,
			Pinned:     &exportMemo.Pinned,
			Payload:    payload,
		}

		if request.PreserveTimestamps {
			update.CreatedTs = &createdTs
			update.UpdatedTs = &updatedTs
		}

		if err := s.Store.UpdateMemo(ctx, update); err != nil {
			return nil, errors.Wrap(err, "failed to update existing memo")
		}
		result.Created = false
	} else {
		// Create new memo
		create := &store.Memo{
			UID:        exportMemo.UID,
			CreatorID:  userID,
			CreatedTs:  createdTs,
			UpdatedTs:  updatedTs,
			Content:    exportMemo.Content,
			Visibility: visibility,
			Pinned:     exportMemo.Pinned,
			Payload:    payload,
		}

		// Rebuild memo payload to extract tags and other metadata
		if err := memopayload.RebuildMemoPayload(create); err != nil {
			return nil, errors.Wrap(err, "failed to rebuild memo payload")
		}

		_, err := s.Store.CreateMemo(ctx, create)
		if err != nil {
			return nil, errors.Wrap(err, "failed to create memo")
		}
		result.Created = true
	}

	// Import attachments if not skipped
	if !request.SkipAttachments && len(exportMemo.Attachments) > 0 {
		result.Warnings = append(result.Warnings, fmt.Sprintf("Attachments for memo %s were skipped (attachment import not yet implemented)", exportMemo.UID))
		// TODO: Implement attachment import
		// This would require handling file uploads and storage
	}

	// Import relations if not skipped
	if !request.SkipRelations && len(exportMemo.Relations) > 0 {
		result.Warnings = append(result.Warnings, fmt.Sprintf("Relations for memo %s were skipped (relation import not yet implemented)", exportMemo.UID))
		// TODO: Implement relation import
		// This would require resolving related memo UIDs and creating relations
	}

	return result, nil
}
