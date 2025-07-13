import React, { useState } from 'react';
import { Download, Upload, FileText, AlertCircle, CheckCircle, X } from 'lucide-react';

const ExportImportComponent = () => {
    const [exportLoading, setExportLoading] = useState(false);
    const [importLoading, setImportLoading] = useState(false);
    const [exportOptions, setExportOptions] = useState({
        format: 'json',
        excludeArchived: false,
        includeAttachments: true,
        includeRelations: true,
        filter: ''
    });
    const [importOptions, setImportOptions] = useState({
        overwriteExisting: false,
        validateOnly: false,
        preserveTimestamps: true,
        skipAttachments: false,
        skipRelations: false
    });
    const [importFile, setImportFile] = useState(null);
    const [importResult, setImportResult] = useState(null);
    const [showImportResult, setShowImportResult] = useState(false);

    const handleExport = async () => {
        setExportLoading(true);
        try {
            const response = await fetch('/api/v1/memos:export', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(exportOptions),
            });

            if (!response.ok) {
                throw new Error('Export failed');
            }

            const data = await response.json();

            // The backend sends the JSON data as a base64-encoded bytes field
            // We need to decode it back to JSON string
            let jsonString;
            if (data.data) {
                // If data.data is a base64 string, decode it
                if (typeof data.data === 'string') {
                    try {
                        // Try to decode as base64 first
                        jsonString = atob(data.data);
                    } catch (e) {
                        // If base64 decode fails, assume it's already a JSON string
                        jsonString = data.data;
                    }
                } else {
                    // If it's already an object, stringify it
                    jsonString = JSON.stringify(data.data, null, 2);
                }
            } else {
                throw new Error('No data received from server');
            }

            // Create blob and download
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = data.filename || 'memos_export.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            // Show success message
            alert(`Export completed! ${data.memoCount} memos exported.`);
        } catch (error) {
            console.error('Export error:', error);
            alert('Export failed: ' + error.message);
        } finally {
            setExportLoading(false);
        }
    };

    const handleImport = async () => {
        if (!importFile) {
            alert('Please select a file to import');
            return;
        }

        setImportLoading(true);
        try {
            const fileContent = await importFile.text();

            // Validate JSON format
            try {
                JSON.parse(fileContent);
            } catch (e) {
                throw new Error('Invalid JSON file');
            }

            const response = await fetch('/api/v1/memos:import', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    data: btoa(fileContent), // Base64 encode the JSON
                    format: 'json',
                    overwriteExisting: importOptions.overwriteExisting,
                    validateOnly: importOptions.validateOnly,
                    preserveTimestamps: importOptions.preserveTimestamps,
                    skipAttachments: importOptions.skipAttachments,
                    skipRelations: importOptions.skipRelations,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Import failed: ${errorText}`);
            }

            const result = await response.json();
            setImportResult(result);
            setShowImportResult(true);
        } catch (error) {
            console.error('Import error:', error);
            alert('Import failed: ' + error.message);
        } finally {
            setImportLoading(false);
        }
    };

    const handleFileSelect = (e) => {
        const file = e.target.files[0];
        if (file) {
            // Accept both .json files and any text file that might contain JSON
            if (file.type === 'application/json' || file.name.endsWith('.json') || file.type === 'text/plain') {
                setImportFile(file);
            } else {
                alert('Please select a JSON file');
                e.target.value = '';
            }
        }
    };

    return (
        <div className="max-w-4xl mx-auto p-6 space-y-8">
            <div className="text-center">
                <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">Export & Import Memos</h1>
                <p className="text-gray-600 dark:text-gray-400">Backup and restore your memos in JSON format</p>
            </div>

            {/* Export Section */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 border border-gray-200 dark:border-gray-700">
                <div className="flex items-center mb-4">
                    <Download className="w-6 h-6 text-blue-600 mr-3" />
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Export Memos</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                            Filter (optional)
                        </label>
                        <input
                            type="text"
                            value={exportOptions.filter}
                            onChange={(e) => setExportOptions({...exportOptions, filter: e.target.value})}
                            placeholder="e.g., tag:important"
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                        />
                    </div>
                    <div className="space-y-3">
                        <label className="flex items-center">
                            <input
                                type="checkbox"
                                checked={exportOptions.excludeArchived}
                                onChange={(e) => setExportOptions({...exportOptions, excludeArchived: e.target.checked})}
                                className="mr-2 h-4 w-4 text-blue-600"
                            />
                            <span className="text-sm text-gray-700 dark:text-gray-300">Exclude archived memos</span>
                        </label>
                        <label className="flex items-center">
                            <input
                                type="checkbox"
                                checked={exportOptions.includeAttachments}
                                onChange={(e) => setExportOptions({...exportOptions, includeAttachments: e.target.checked})}
                                className="mr-2 h-4 w-4 text-blue-600"
                            />
                            <span className="text-sm text-gray-700 dark:text-gray-300">Include attachments</span>
                        </label>
                        <label className="flex items-center">
                            <input
                                type="checkbox"
                                checked={exportOptions.includeRelations}
                                onChange={(e) => setExportOptions({...exportOptions, includeRelations: e.target.checked})}
                                className="mr-2 h-4 w-4 text-blue-600"
                            />
                            <span className="text-sm text-gray-700 dark:text-gray-300">Include memo relations</span>
                        </label>
                    </div>
                </div>

                <button
                    onClick={handleExport}
                    disabled={exportLoading}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-6 py-2 rounded-md font-medium flex items-center transition-colors"
                >
                    {exportLoading ? (
                        <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                            Exporting...
                        </>
                    ) : (
                        <>
                            <Download className="w-4 h-4 mr-2" />
                            Export Memos
                        </>
                    )}
                </button>
            </div>

            {/* Import Section */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 border border-gray-200 dark:border-gray-700">
                <div className="flex items-center mb-4">
                    <Upload className="w-6 h-6 text-green-600 mr-3" />
                    <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Import Memos</h2>
                </div>

                <div className="mb-6">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Select JSON file
                    </label>
                    <div className="flex items-center">
                        <input
                            type="file"
                            accept=".json,application/json,text/plain"
                            onChange={handleFileSelect}
                            className="block w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-gray-50 dark:file:bg-gray-600 file:text-gray-700 dark:file:text-gray-200 hover:file:bg-gray-100 dark:hover:file:bg-gray-500 transition-colors"
                        />
                        {importFile && (
                            <div className="ml-4 flex items-center text-green-600">
                                <FileText className="w-4 h-4 mr-1" />
                                <span className="text-sm">{importFile.name}</span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <div className="space-y-3">
                        <label className="flex items-center">
                            <input
                                type="checkbox"
                                checked={importOptions.overwriteExisting}
                                onChange={(e) => setImportOptions({...importOptions, overwriteExisting: e.target.checked})}
                                className="mr-2 h-4 w-4 text-green-600"
                            />
                            <span className="text-sm text-gray-700 dark:text-gray-300">Overwrite existing memos</span>
                        </label>
                        <label className="flex items-center">
                            <input
                                type="checkbox"
                                checked={importOptions.validateOnly}
                                onChange={(e) => setImportOptions({...importOptions, validateOnly: e.target.checked})}
                                className="mr-2 h-4 w-4 text-green-600"
                            />
                            <span className="text-sm text-gray-700 dark:text-gray-300">Validate only (dry run)</span>
                        </label>
                        <label className="flex items-center">
                            <input
                                type="checkbox"
                                checked={importOptions.preserveTimestamps}
                                onChange={(e) => setImportOptions({...importOptions, preserveTimestamps: e.target.checked})}
                                className="mr-2 h-4 w-4 text-green-600"
                            />
                            <span className="text-sm text-gray-700 dark:text-gray-300">Preserve original timestamps</span>
                        </label>
                    </div>
                    <div className="space-y-3">
                        <label className="flex items-center">
                            <input
                                type="checkbox"
                                checked={importOptions.skipAttachments}
                                onChange={(e) => setImportOptions({...importOptions, skipAttachments: e.target.checked})}
                                className="mr-2 h-4 w-4 text-green-600"
                            />
                            <span className="text-sm text-gray-700 dark:text-gray-300">Skip attachments</span>
                        </label>
                        <label className="flex items-center">
                            <input
                                type="checkbox"
                                checked={importOptions.skipRelations}
                                onChange={(e) => setImportOptions({...importOptions, skipRelations: e.target.checked})}
                                className="mr-2 h-4 w-4 text-green-600"
                            />
                            <span className="text-sm text-gray-700 dark:text-gray-300">Skip memo relations</span>
                        </label>
                    </div>
                </div>

                <button
                    onClick={handleImport}
                    disabled={importLoading || !importFile}
                    className="bg-green-600 hover:bg-green-700 disabled:bg-green-400 text-white px-6 py-2 rounded-md font-medium flex items-center transition-colors"
                >
                    {importLoading ? (
                        <>
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                            Importing...
                        </>
                    ) : (
                        <>
                            <Upload className="w-4 h-4 mr-2" />
                            Import Memos
                        </>
                    )}
                </button>
            </div>

            {/* Import Result Modal */}
            {showImportResult && importResult && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                    <div className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto border border-gray-200 dark:border-gray-700">
                        <div className="p-6">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Import Results</h3>
                                <button
                                    onClick={() => setShowImportResult(false)}
                                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                                >
                                    <X className="w-6 h-6" />
                                </button>
                            </div>

                            <div className="space-y-4">
                                {/* Summary Statistics */}
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded-lg text-center border border-green-200 dark:border-green-800">
                                        <div className="text-2xl font-bold text-green-600 dark:text-green-400">{importResult.importedCount}</div>
                                        <div className="text-sm text-green-700 dark:text-green-300">Imported</div>
                                    </div>
                                    <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-lg text-center border border-yellow-200 dark:border-yellow-800">
                                        <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{importResult.skippedCount}</div>
                                        <div className="text-sm text-yellow-700 dark:text-yellow-300">Skipped</div>
                                    </div>
                                    <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg text-center border border-blue-200 dark:border-blue-800">
                                        <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">{importResult.summary?.createdCount || 0}</div>
                                        <div className="text-sm text-blue-700 dark:text-blue-300">Created</div>
                                    </div>
                                    <div className="bg-purple-50 dark:bg-purple-900/20 p-3 rounded-lg text-center border border-purple-200 dark:border-purple-800">
                                        <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{importResult.summary?.updatedCount || 0}</div>
                                        <div className="text-sm text-purple-700 dark:text-purple-300">Updated</div>
                                    </div>
                                </div>

                                {/* Detailed Summary */}
                                {importResult.summary && (
                                    <div className="bg-gray-50 dark:bg-gray-700 p-4 rounded-lg border border-gray-200 dark:border-gray-600">
                                        <h4 className="font-medium mb-2 text-gray-900 dark:text-gray-100">Summary</h4>
                                        <div className="text-sm text-gray-700 dark:text-gray-300 space-y-1">
                                            <div>Total memos in file: {importResult.summary.totalMemos}</div>
                                            <div>Duration: {importResult.summary.durationMs}ms</div>
                                            {importResult.summary.attachmentsImported > 0 && (
                                                <div>Attachments imported: {importResult.summary.attachmentsImported}</div>
                                            )}
                                            {importResult.summary.relationsImported > 0 && (
                                                <div>Relations imported: {importResult.summary.relationsImported}</div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Warnings */}
                                {importResult.warnings && importResult.warnings.length > 0 && (
                                    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                                        <div className="flex items-center mb-2">
                                            <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 mr-2" />
                                            <h4 className="font-medium text-yellow-800 dark:text-yellow-200">Warnings</h4>
                                        </div>
                                        <ul className="list-disc list-inside text-sm text-yellow-700 dark:text-yellow-300 space-y-1">
                                            {importResult.warnings.map((warning, index) => (
                                                <li key={index}>{warning}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {/* Errors */}
                                {importResult.errors && importResult.errors.length > 0 && (
                                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                                        <div className="flex items-center mb-2">
                                            <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 mr-2" />
                                            <h4 className="font-medium text-red-800 dark:text-red-200">Errors</h4>
                                        </div>
                                        <ul className="list-disc list-inside text-sm text-red-700 dark:text-red-300 space-y-1">
                                            {importResult.errors.map((error, index) => (
                                                <li key={index}>{error}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {/* Success message */}
                                {importResult.importedCount > 0 && (
                                    <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
                                        <div className="flex items-center">
                                            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 mr-2" />
                                            <span className="text-green-800 dark:text-green-200 font-medium">
                        Import completed successfully!
                      </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Help Section */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
                <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-2">Export/Import Guidelines</h3>
                <div className="text-sm text-blue-800 dark:text-blue-200 space-y-2">
                    <p><strong>Export:</strong> Creates a JSON file containing all your memos with metadata, tags, and optionally attachments and relations.</p>
                    <p><strong>Import:</strong> Restores memos from a JSON file. Use "Validate only" to check for issues before importing.</p>
                    <p><strong>UID Conflicts:</strong> Each memo has a unique identifier (UID). Enable "Overwrite existing" to update memos with matching UIDs.</p>
                    <p><strong>Timestamps:</strong> Original creation and update times are preserved by default during import.</p>
                </div>
            </div>
        </div>
    );
};

export default ExportImportComponent;