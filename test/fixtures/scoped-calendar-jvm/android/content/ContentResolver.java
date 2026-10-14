package android.content;
public abstract class ContentResolver {public abstract android.database.Cursor query(android.net.Uri uri,String[] projection,String selection,String[] arguments,String sort);public abstract void applyBatch(String authority,java.util.ArrayList<ContentProviderOperation> operations)throws Exception;}
