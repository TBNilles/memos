import { observer } from "mobx-react-lite";
import ExportImportComponent from "@/components/ExportImport";

const ExportImport = observer(() => {
    return (
        <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <ExportImportComponent />
        </div>
    );
});

export default ExportImport;