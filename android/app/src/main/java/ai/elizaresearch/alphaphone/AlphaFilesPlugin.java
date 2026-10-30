package ai.elizaresearch.alphaphone;

import ai.eliza.plugins.media.FilesPlugin;
import ai.eliza.plugins.media.SelectedDocuments;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Installed identity and storage configuration over the common Files bridge. */
@CapacitorPlugin(name="AlphaFiles")
public class AlphaFilesPlugin extends FilesPlugin {
 static final String PREF="alpha-files-tree";
 @Override protected String treePreferenceName(){return PREF;}
 @Override protected SelectedDocuments documents(){return SelectedDocumentAccess.documents(getContext());}
}
